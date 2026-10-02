import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import type { PublicEventView } from "@shared/api";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import { store } from "@/store";
import { resetLeadForm } from "@/store/slices/leadSlice";
import LeadForm from "./LeadForm";

const event: PublicEventView = {
  id: 7,
  slug: "fontana-oct",
  city: "Fontana",
  starts_at: "2026-10-06 18:00:00",
  ends_at: null,
  capacity: 50,
  waitlist_enabled: true,
  confirmed_count: 10,
  spots_remaining: 40,
  registration_open: true,
  venue_name: null,
  venue_address: null,
  zoom_url: null,
  image_url: null,
  title: "Fontana homeowner night",
  summary: null,
  body: null,
  location_label: null,
  cta: null,
};

const mount = (
  e: PublicEventView | null,
  opts?: { creditNextHref?: string },
) =>
  render(
    <Provider store={store}>
      <MemoryRouter>
        <LeadForm event={e} creditNextHref={opts?.creditNextHref} />
      </MemoryRouter>
    </Provider>,
  );

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText(i18n.t("form.name")), "Ana Lopez");
  await userEvent.type(screen.getByLabelText(i18n.t("form.phone")), "5551234567");
  await userEvent.type(screen.getByLabelText(i18n.t("form.email")), "ana@example.com");
  await userEvent.type(screen.getByLabelText(i18n.t("form.address")), "12 Main St, Fontana");
  await userEvent.click(screen.getByRole("button"));
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  store.dispatch(resetLeadForm());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LeadForm", () => {
  it("event RSVP has no soft-pull checkbox and sends mode=event + event_id", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: {
        ok: true,
        lead_id: 1,
        message: "ok",
        event_registration_status: "waitlisted",
        credit_cta_url: "/get-credit-report",
      },
    });
    mount(event);
    expect(screen.queryByRole("checkbox")).toBeNull();
    await fillAndSubmit();
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    expect(post.mock.calls[0][0]).toBe("/public/leads");
    expect(body).toMatchObject({ mode: "event", event_id: 7, event_city: "Fontana", soft_pull_consent: false });
    expect(await screen.findByText(i18n.t("event.waitlistedThanks"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(i18n.t("event.creditNext")) })).toHaveAttribute(
      "href",
      "/get-credit-report",
    );
  });

  it("event success can deep-link to an on-page free-report hash", async () => {
    vi.spyOn(api, "post").mockResolvedValue({
      data: {
        ok: true,
        lead_id: 1,
        message: "ok",
        event_registration_status: "confirmed",
        credit_cta_url: "/get-credit-report",
      },
    });
    mount(event, { creditNextHref: "#free-report" });
    await fillAndSubmit();
    expect(
      await screen.findByRole("link", { name: new RegExp(i18n.t("event.creditNext")) }),
    ).toHaveAttribute("href", "#free-report");
  });

  it("standard mode keeps the soft-pull consent and omits event_id", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { ok: true, lead_id: 2, message: "ok" } });
    mount(null);
    expect(screen.getByRole("checkbox")).toBeChecked();
    await fillAndSubmit();
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    expect(body).toMatchObject({ mode: "standard", event_id: null, soft_pull_consent: true });
  });

  it("shows the closed message instead of the form when registration is closed", () => {
    mount({ ...event, registration_open: false });
    expect(screen.getByText(i18n.t("event.registrationClosed"))).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
