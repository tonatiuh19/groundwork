import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import axios from "axios";
import { LayoutDashboard, Settings, Users } from "lucide-react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AdminRole, PortalAuthUser } from "@shared/api";
import i18n from "@/i18n";
import { store } from "@/store";
import portalAuthReducer, {
  logoutPortal,
  portalSessionExpired,
  verifyPortalOtp,
} from "@/store/slices/portalAuthSlice";
import { useAdminCan } from "@/hooks/useAdminCan";
import PortalShell from "./PortalShell";

const nav = [
  { to: "/admin", end: true, labelKey: "portalNav.dashboard", icon: LayoutDashboard },
  { to: "/admin/staff", labelKey: "portalNav.staff", icon: Users, perm: "staff" as const },
  { to: "/admin/settings", labelKey: "portalNav.settings", icon: Settings, perm: "settings" as const },
  // "any of" perms: content (events) and agents (leads) both see it; finance does not.
  { to: "/admin/events", labelKey: "portalNav.events", icon: Users, perm: ["events", "leads"] as const },
];

const admin = (role: AdminRole): PortalAuthUser => ({
  id: 1,
  email: "boss@example.com",
  first_name: "Bo",
  last_name: "Ss",
  status: "active",
  preferred_language: "en",
  role,
});

const signIn = (actor: "admin" | "client", u: PortalAuthUser) =>
  store.dispatch(
    verifyPortalOtp.fulfilled({ actor, user: u } as any, "req", { actor, email: u.email, code: "000000" }),
  );

function Gate() {
  return <p>{useAdminCan("finance.write") ? "can-finance" : "no-finance"}</p>;
}

function mount(target: typeof store = store) {
  render(
    <Provider store={target}>
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin/login" element={<p>LOGIN PAGE</p>} />
          <Route
            path="/admin"
            element={<PortalShell actor="admin" loginPath="/admin/login" titleKey="portalNav.adminTitle" nav={nav} />}
          >
            <Route index element={<Gate />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  for (const a of ["admin", "client"] as const) await store.dispatch(logoutPortal(a));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PortalShell guard", () => {
  it("shows a shell skeleton while /auth/me is pending", async () => {
    vi.spyOn(axios, "get").mockReturnValue(new Promise(() => {}));
    mount(configureStore({ reducer: { portalAuth: portalAuthReducer } }) as unknown as typeof store);
    expect(await screen.findByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(i18n.t("portalAuth.loading"))).toBeInTheDocument();
    expect(document.querySelector(".portal-shell--skeleton")).toBeTruthy();
  });

  it("bootstraps the session via /auth/me and redirects to login on 401", async () => {
    const get = vi.spyOn(axios, "get").mockRejectedValue(new Error("401"));
    // A fresh store models a page load: `bootstrapped` is false until /auth/me settles.
    mount(configureStore({ reducer: { portalAuth: portalAuthReducer } }) as unknown as typeof store);
    await waitFor(() => expect(screen.getByText("LOGIN PAGE")).toBeInTheDocument());
    expect(get).toHaveBeenCalledWith("/api/admin/auth/me", { withCredentials: true });
  });

  it("does not trust another portal's session", async () => {
    signIn("client", { ...admin("super_admin"), role: undefined });
    vi.spyOn(axios, "get").mockRejectedValue(new Error("401"));
    mount();
    await waitFor(() => expect(screen.getByText("LOGIN PAGE")).toBeInTheDocument());
  });

  it("kicks the user out when an API call reports an expired session", async () => {
    signIn("admin", admin("super_admin"));
    mount();
    expect(await screen.findByText("Bo Ss")).toBeInTheDocument();
    store.dispatch(portalSessionExpired("admin"));
    await waitFor(() => expect(screen.getByText("LOGIN PAGE")).toBeInTheDocument());
  });

  it("hides nav items the role cannot use and shows the role chip", async () => {
    signIn("admin", admin("agent"));
    mount();
    expect(await screen.findByText(i18n.t("portalNav.dashboard"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("portalNav.staff"))).toBeNull(); // super_admin only
    expect(screen.queryByText(i18n.t("portalNav.settings"))).toBeNull(); // super_admin / finance
    expect(screen.getByText(i18n.t("role.agent"))).toHaveClass("portal-role");
    expect(screen.getByText("no-finance")).toBeInTheDocument();
    const profile = screen.getByRole("link", { name: i18n.t("admin.profileNav") });
    expect(profile).toHaveAttribute("href", "/admin/profile");
    expect(profile).toHaveClass("portal-sidebar-user--link");
  });

  it("super admins see everything; finance sees settings but not staff", async () => {
    signIn("admin", admin("super_admin"));
    mount();
    expect(await screen.findByText(i18n.t("portalNav.staff"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("portalNav.settings"))).toBeInTheDocument();
    expect(screen.getByText("can-finance")).toBeInTheDocument();
    cleanup();
    signIn("admin", admin("finance"));
    mount();
    expect(await screen.findByText(i18n.t("portalNav.settings"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("portalNav.staff"))).toBeNull();
  });

  it("array perms are any-of: events OR leads", async () => {
    for (const [role, visible] of [
      ["content", true],
      ["agent", true],
      ["finance", false],
    ] as const) {
      signIn("admin", admin(role));
      mount();
      await screen.findByText(i18n.t("portalNav.dashboard"));
      const link = screen.queryByText(i18n.t("portalNav.events"));
      expect(Boolean(link)).toBe(visible);
      cleanup();
    }
  });

  it("logout calls the API, clears the session and returns to login", async () => {
    signIn("admin", admin("super_admin"));
    const post = vi.spyOn(axios, "post").mockResolvedValue({ data: { ok: true } });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: new RegExp(i18n.t("portalAuth.logout")) }));
    await waitFor(() => expect(screen.getByText("LOGIN PAGE")).toBeInTheDocument());
    expect(post).toHaveBeenCalledWith("/api/admin/auth/logout", {}, { withCredentials: true });
    expect(store.getState().portalAuth.admin.user).toBeNull();
  });
});
