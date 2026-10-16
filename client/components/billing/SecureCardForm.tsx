import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadStripe, type StripeElementStyle } from "@stripe/stripe-js";
import {
  CardCvcElement,
  CardExpiryElement,
  CardNumberElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { CalendarClock, CreditCard, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { BusyButton, ErrorNote } from "@/components/portal/kit";
import { logger } from "@/utils/logger";
import { cn } from "@/lib/cn";

const PUBLISHABLE_KEY = String(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "");
// Loaded once, only when a card form is shown.
let processorPromise: ReturnType<typeof loadStripe> | null = null;
const getProcessor = () => (processorPromise ??= PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : Promise.resolve(null));

/** Card fields render in secure iframes; they take concrete colors (CSS vars don't cross the frame). */
const FIELD_STYLE: StripeElementStyle = {
  base: {
    color: "#1f2430",
    fontFamily: "Manrope, system-ui, sans-serif",
    fontSize: "16px",
    fontWeight: "500",
    letterSpacing: "0.02em",
    "::placeholder": { color: "#9aa0ab" },
    iconColor: "#0e2a4a",
  },
  invalid: { color: "#c1633b", iconColor: "#c1633b" },
  complete: { iconColor: "#1f4a3a" },
};

const BRAND_LABEL: Record<string, string> = {
  visa: "VISA",
  mastercard: "Mastercard",
  amex: "AMEX",
  discover: "Discover",
  diners: "Diners",
  jcb: "JCB",
  unionpay: "UnionPay",
};

type FieldKey = "number" | "expiry" | "cvc";

/** Role-agnostic wiring: each portal passes its own store thunks. */
export type CardFormBindings = {
  name: string;
  email: string;
  busy: boolean;
  error: string | null;
  /** Ask our API for a one-time setup secret (null = failed; the store shows why). */
  setup: () => Promise<string | null>;
  /** Tell our API the card was confirmed; true when saved. */
  activate: (setupIntentId: string) => Promise<boolean>;
  /** Show a confirmation error from the card processor. */
  fail: (message: string) => void;
  onSaved?: () => void;
};

function CardFields({ name, email, busy: cardBusy, error: cardError, setup: startSetup, activate, fail, onSaved }: CardFormBindings) {
  const { t } = useTranslation();
  const processor = useStripe();
  const elements = useElements();
  const [brand, setBrand] = useState<string>("unknown");
  const [done, setDone] = useState<Record<FieldKey, boolean>>({ number: false, expiry: false, cvc: false });
  const [focus, setFocus] = useState<FieldKey | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const ready = Boolean(processor && elements) && done.number && done.expiry && done.cvc;

  const track = (key: FieldKey) => ({
    options: { style: FIELD_STYLE, ...(key === "number" ? { showIcon: true, iconStyle: "solid" as const, disableLink: true } : {}) },
    onFocus: () => setFocus(key),
    onBlur: () => setFocus(null),
    onChange: (e: { complete: boolean; error?: { message: string }; brand?: string }) => {
      setDone((d) => ({ ...d, [key]: e.complete }));
      setFieldError(e.error?.message ?? null);
      if (key === "number" && e.brand) setBrand(e.brand);
    },
  });

  const save = async () => {
    if (!processor || !elements) return;
    const card = elements.getElement(CardNumberElement);
    if (!card) return;
    const secret = await startSetup();
    if (!secret) return;
    const confirmed = await processor.confirmCardSetup(secret, {
      payment_method: { card, billing_details: { name: name || undefined, email: email || undefined } },
    });
    if (confirmed.error || !confirmed.setupIntent) {
      logger.warn("card confirmation failed", confirmed.error?.code);
      fail(confirmed.error?.message || "errors.cardNotConfirmed");
      return;
    }
    if (await activate(confirmed.setupIntent.id)) onSaved?.();
  };

  return (
    <div className="gw-card-form">
      <div className="gw-card-form__head">
        <span className="gw-card-form__lock" aria-hidden>
          <Lock size={16} />
        </span>
        <div>
          <strong>{t("affBilling.secureTitle")}</strong>
          <span>{t("affBilling.secureLead")}</span>
        </div>
        {BRAND_LABEL[brand] ? <span className="gw-card-brand">{BRAND_LABEL[brand]}</span> : null}
      </div>

      <label className={cn("gw-card-field", focus === "number" && "is-focus", done.number && "is-done")}>
        <span className="gw-card-field__label">
          <CreditCard size={14} aria-hidden /> {t("affBilling.cardNumber")}
        </span>
        <CardNumberElement {...track("number")} className="gw-card-field__input" />
      </label>
      <div className="gw-card-form__row">
        <label className={cn("gw-card-field", focus === "expiry" && "is-focus", done.expiry && "is-done")}>
          <span className="gw-card-field__label">
            <CalendarClock size={14} aria-hidden /> {t("affBilling.expiry")}
          </span>
          <CardExpiryElement {...track("expiry")} className="gw-card-field__input" />
        </label>
        <label className={cn("gw-card-field", focus === "cvc" && "is-focus", done.cvc && "is-done")}>
          <span className="gw-card-field__label">
            <KeyRound size={14} aria-hidden /> {t("affBilling.cvc")}
          </span>
          <CardCvcElement {...track("cvc")} className="gw-card-field__input" />
        </label>
      </div>
      {fieldError ? (
        <p className="form-error" role="alert">
          {fieldError}
        </p>
      ) : null}
      <ErrorNote error={cardError} />

      <BusyButton
        tone="gold"
        icon={ShieldCheck}
        className="gw-card-form__submit"
        label={t("affBilling.saveCard")}
        busyLabel={t("affBilling.saving")}
        busy={cardBusy}
        disabled={!ready}
        onClick={() => void save()}
      />
      <ul className="gw-card-form__trust">
        <li>
          <Lock size={13} aria-hidden /> {t("affBilling.trustEncrypted")}
        </li>
        <li>
          <ShieldCheck size={13} aria-hidden /> {t("affBilling.trustNeverStored")}
        </li>
      </ul>
    </div>
  );
}

/**
 * Secure card form (card on file → free period → monthly). Fields are the
 * payment processor's hosted inputs, styled to our brand; card data goes
 * straight to the processor and never reaches our servers. The processor is
 * internal — the UI never names it.
 */
export default function SecureCardForm(props: CardFormBindings) {
  const { t, i18n } = useTranslation();
  const processor = useMemo(() => getProcessor(), []);
  if (!PUBLISHABLE_KEY) return <p className="gw-onboard-note">{t("affBilling.notAvailable")}</p>;
  return (
    <Elements
      stripe={processor}
      options={{
        locale: i18n.language?.startsWith("es") ? "es" : "en",
        fonts: [{ cssSrc: "https://fonts.googleapis.com/css2?family=Manrope:wght@500;600&display=swap" }],
      }}
    >
      <CardFields {...props} />
    </Elements>
  );
}
