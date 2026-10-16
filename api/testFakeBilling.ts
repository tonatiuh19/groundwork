import Stripe from "stripe";

/** Fake payment processor: records calls, never touches the network. */
export function makeFakeBilling() {
  const calls: Record<string, unknown[]> = {};
  const log = (k: string, v: unknown) => (calls[k] ||= []).push(v);
  const subs = new Map<string, Stripe.Subscription>();
  const events = new Map<string, Stripe.Event>();
  let customerN = 0;
  /** Card details per payment method id (tests set expiries / bank updates here). */
  const cards = new Map<string, { brand: string; last4: string; exp_month: number; exp_year: number }>();
  /** Paid invoices per id (tests add them with addInvoice). */
  const invoices = new Map<string, unknown>();
  const refunded = new Map<string, number>();
  const addInvoice = (id: string, customer: string, amount: number) =>
    invoices.set(id, {
      id,
      customer,
      number: `GW-${id.slice(-4).toUpperCase()}`,
      status: "paid",
      created: Math.floor(Date.now() / 1000),
      period_start: Math.floor(Date.now() / 1000),
      period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
      amount_due: amount,
      amount_paid: amount,
      hosted_invoice_url: `https://pay.example.test/i/${id}`,
      invoice_pdf: `https://pay.example.test/i/${id}.pdf`,
    });
  let lastCustomer = "";
  const real = new Stripe("sk_test_offline_only");
  const fake = {
    prices: {
      list: async (p: unknown) => (log("prices.list", p), { data: [] }),
      create: async (p: unknown) => (log("prices.create", p), { id: "price_gw_test" }),
    },
    customers: {
      create: async (p: unknown) => (log("customers.create", p), { id: (lastCustomer = `cus_gwtest${++customerN}`) }),
      update: async (id: string, p: unknown) => (log("customers.update", { id, p }), { id }),
      retrieve: async (id: string) => ({ id }),
    },
    setupIntents: {
      create: async (p: { customer: string }) => (
        log("setupIntents.create", p), (lastCustomer = p.customer), { id: "seti_gwtest", client_secret: "seti_gwtest_secret_x" }
      ),
      // "seti_gwtestZx" confirms card pm_x; plain ids confirm pm_gwtest.
      retrieve: async (id: string) => ({
        id,
        customer: lastCustomer,
        status: "succeeded",
        payment_method: id.startsWith("seti_gwtestZ") ? `pm_${id.slice("seti_gwtestZ".length)}` : "pm_gwtest",
      }),
    },
    paymentMethods: {
      retrieve: async (id: string) => ({ id, card: cards.get(id) ?? { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } }),
      detach: async (id: string) => (log("paymentMethods.detach", id), { id }),
    },
    subscriptions: {
      create: async (p: any) => {
        log("subscriptions.create", p);
        const now = Math.floor(Date.now() / 1000);
        const sub = {
          id: `sub_gwtest${subs.size + 1}`,
          status: p.trial_period_days ? "trialing" : "active",
          trial_end: p.trial_period_days ? now + p.trial_period_days * 86400 : null,
          cancel_at_period_end: false,
          customer: p.customer,
          metadata: p.metadata,
          items: { data: [{ id: "si_gwtest", current_period_end: now + (p.trial_period_days || 30) * 86400 }] },
        } as unknown as Stripe.Subscription;
        subs.set(sub.id, sub);
        return sub;
      },
      update: async (id: string, p: any) => {
        log("subscriptions.update", { id, p });
        const prev = subs.get(id) as any;
        const sub = {
          ...prev,
          ...("cancel_at_period_end" in p ? { cancel_at_period_end: p.cancel_at_period_end } : {}),
          ...("trial_end" in p ? { trial_end: p.trial_end, status: "trialing" } : {}),
          ...(p.items ? { items: { data: [{ ...prev.items.data[0], id: "si_gwtest", price: { id: p.items[0].price } }] } } : {}),
        };
        subs.set(id, sub);
        return sub;
      },
      retrieve: async (id: string) => subs.get(id),
      cancel: async (id: string) => {
        log("subscriptions.cancel", id);
        const sub = { ...(subs.get(id) as any), status: "canceled" };
        subs.set(id, sub);
        return sub;
      },
    },
    invoices: {
      list: async (p: { customer?: string; subscription?: string }) => ({
        data: [...invoices.values()].filter((i: any) => !p.customer || i.customer === p.customer),
      }),
      retrieve: async (id: string) => invoices.get(id),
      pay: async (id: string, p: unknown) => (log("invoices.pay", { id, p }), { id, status: "paid" }),
    },
    invoicePayments: {
      list: async (p: { invoice: string }) => ({
        data: invoices.get(p.invoice) ? [{ payment: { payment_intent: `pi_${p.invoice}` } }] : [],
      }),
    },
    paymentIntents: {
      retrieve: async (id: string) => {
        const inv = invoices.get(id.replace(/^pi_/, "")) as any;
        return {
          id,
          latest_charge: { amount: inv?.amount_paid ?? 0, amount_refunded: refunded.get(id) ?? 0, receipt_url: `https://pay.example.test/receipt/${id}` },
        };
      },
    },
    refunds: {
      create: async (p: { payment_intent: string; amount: number }) => {
        log("refunds.create", p);
        refunded.set(p.payment_intent, (refunded.get(p.payment_intent) ?? 0) + p.amount);
        return { id: `re_gwtest${refunded.size}`, status: "succeeded", amount: p.amount };
      },
    },
    events: { retrieve: async (id: string) => events.get(id) },
    webhooks: real.webhooks,
  };
  return { fake, calls, subs, events, cards, addInvoice };
}
