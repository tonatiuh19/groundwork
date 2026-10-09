import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import adminPortalReducer from "@/store/slices/adminPortalSlice";
import portalAuthReducer from "@/store/slices/portalAuthSlice";
import personConflictReducer from "@/store/slices/personConflictSlice";
import duplicatesReducer from "@/store/slices/duplicatesSlice";
import AdminLeads from "./Leads";

const user = userEvent.setup();

const sampleLead = {
  id: 42,
  full_name: "Angelica Rivera",
  email: "angelica@example.com",
  phone: "9495559999",
  property_address: null,
  mode: "standard" as const,
  event_city: null,
  event_id: null,
  event_registration_status: null,
  source: "partner_referral",
  audience_tag: null,
  affiliate_id: null,
  affiliate_name: null,
  client_id: null,
  converted_affiliate_id: null,
  converted_contractor_id: null,
  referral_code: null,
  notes: "company=Encore Mortgage",
  status: "new" as const,
  created_at: "2026-10-08T00:00:00.000Z",
};

function mount(role: "super_admin" | "agent" = "super_admin") {
  const emptyPortal = {
    user: null,
    bootstrapped: true,
    loadingMe: false,
    requesting: false,
    verifying: false,
    otpEmail: null,
    error: null,
  };
  const store = configureStore({
    reducer: {
      adminPortal: adminPortalReducer,
      portalAuth: portalAuthReducer,
      personConflict: personConflictReducer,
      duplicates: duplicatesReducer,
    },
    preloadedState: {
      portalAuth: {
        admin: {
          ...emptyPortal,
          user: {
            id: 1,
            email: "admin@example.com",
            first_name: "Ada",
            last_name: "Min",
            role,
            status: "active",
            preferred_language: "en",
          },
        },
        affiliate: emptyPortal,
        contractor: emptyPortal,
        client: emptyPortal,
      },
    },
  } as any);

  vi.spyOn(api, "get").mockImplementation(async (url: string) => {
    if (String(url).includes("/admin/leads")) {
      return {
        data: { leads: [sampleLead], total: 1, limit: 50, offset: 0 },
      } as any;
    }
    if (String(url).includes("/admin/events")) {
      return { data: { events: [], total: 0 } } as any;
    }
    if (String(url).includes("/admin/duplicates")) {
      return { data: { ok: true, clusters: [], total: 0 } } as any;
    }
    if (String(url).includes("/admin/plans")) {
      return {
        data: {
          plans: [{ id: 7, name: "Fontana 1BR", is_active: true }],
        },
      } as any;
    }
    return { data: {} } as any;
  });

  render(
    <HelmetProvider>
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <AdminLeads />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>
    </HelmetProvider>,
  );
  return store;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Admin Leads Convert modal", () => {
  it("opens convert with Affiliate smart-default for partner_referral", async () => {
    mount("super_admin");
    expect(await screen.findByText("Angelica Rivera")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: new RegExp(i18n.t("admin.convert")) }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(i18n.t("admin.convertTargetAffiliate"))).toBeInTheDocument();
    const affiliateRadio = within(dialog).getByRole("radio", {
      name: i18n.t("admin.convertTargetAffiliate"),
    });
    expect(affiliateRadio).toBeChecked();
    expect(
      within(dialog).getByRole("radio", { name: i18n.t("admin.convertStatusActive") }),
    ).toBeChecked();
  });

  it("posts affiliate convert with chosen status", async () => {
    mount("super_admin");
    const post = vi.spyOn(api, "post").mockResolvedValue({
      data: { ok: true, target: "affiliate", affiliate_id: 99 },
    } as any);
    await screen.findByText("Angelica Rivera");
    await user.click(screen.getByRole("button", { name: new RegExp(i18n.t("admin.convert")) }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("radio", { name: i18n.t("admin.convertStatusPending") }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: new RegExp(`^${i18n.t("admin.convert")}$`) }),
    );
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith("/admin/leads/42/convert", {
        target: "affiliate",
        adu_plan_id: null,
        status: "pending",
        confirm_phone_link: undefined,
      });
    });
  });

  it("hides affiliate/contractor targets for agent (projects.write only)", async () => {
    mount("agent");
    await screen.findByText("Angelica Rivera");
    await user.click(screen.getByRole("button", { name: new RegExp(i18n.t("admin.convert")) }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).queryByRole("radio", { name: i18n.t("admin.convertTargetAffiliate") }),
    ).toBeNull();
    expect(
      within(dialog).getByRole("radio", { name: i18n.t("admin.convertTargetClient") }),
    ).toBeChecked();
  });

  it("shows phone-link confirm when API returns phone_match", async () => {
    mount("super_admin");
    const { AxiosError } = await import("axios");
    vi.spyOn(api, "post").mockRejectedValueOnce(
      new AxiosError("conflict", "ERR_BAD_RESPONSE", undefined, undefined, {
        status: 409,
        data: {
          error: "errors.phoneLinkConfirmRequired",
          phone_match: {
            entity: "affiliate",
            id: 9,
            email: "other@example.com",
            name: "Other Aff",
          },
        },
      } as any),
    );

    await screen.findByText("Angelica Rivera");
    await user.click(screen.getByRole("button", { name: new RegExp(i18n.t("admin.convert")) }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: new RegExp(`^${i18n.t("admin.convert")}$`) }),
    );
    expect(
      await screen.findByRole("dialog", { name: i18n.t("admin.convertPhoneLinkTitle") }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Other Aff/)).toBeInTheDocument();
  });
});
