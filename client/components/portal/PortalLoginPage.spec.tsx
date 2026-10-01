import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios, { AxiosError } from "axios";
import { HelmetProvider } from "react-helmet-async";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "@/i18n";
import { store } from "@/store";
import { logoutPortal } from "@/store/slices/portalAuthSlice";
import PortalLoginPage from "./PortalLoginPage";

const user = userEvent.setup();

const axiosError = (status: number, error: string) =>
  new AxiosError("fail", "ERR_BAD_RESPONSE", undefined, undefined, {
    status,
    data: { error },
  } as any);

function mount(actor: "admin" | "affiliate" | "contractor" | "client" = "affiliate") {
  render(
    <HelmetProvider>
      <Provider store={store}>
        <MemoryRouter initialEntries={[`/${actor}/login`]}>
          <Routes>
            <Route path={`/${actor}/login`} element={<PortalLoginPage actor={actor} homePath={`/${actor}`} />} />
            <Route path={`/${actor}`} element={<p>HOME:{actor}</p>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    </HelmetProvider>,
  );
}

const emailInput = () => screen.getByLabelText(i18n.t("form.email"));
const digitBox = (n = 1) =>
  screen.getByLabelText(
    i18n.t("portalAuth.digitOf", { current: n, total: 6 }),
  );
const verifyBtn = () =>
  screen.getByRole("button", { name: new RegExp(i18n.t("portalAuth.verify")) });

async function reachCodeStep(email = "pat@example.com") {
  await user.type(emailInput(), email);
  await user.click(screen.getByRole("button", { name: new RegExp(i18n.t("portalAuth.sendCode")) }));
  await screen.findByText(i18n.t("portalAuth.codeStep"));
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  for (const a of ["admin", "affiliate", "contractor", "client"] as const) {
    await store.dispatch(logoutPortal(a));
  }
  // No live session — login form should render after /auth/me 401.
  vi.spyOn(axios, "get").mockRejectedValue(axiosError(401, "errors.unauthorized"));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PortalLoginPage", () => {
  it("redirects to the portal home when a session already exists", async () => {
    vi.spyOn(axios, "get").mockResolvedValue({
      data: {
        user: {
          id: 7,
          email: "pat@example.com",
          first_name: "Pat",
          last_name: "Lee",
          role: "affiliate",
          status: "active",
        },
      },
    });
    mount("affiliate");
    expect(await screen.findByText("HOME:affiliate")).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith("/api/affiliate/auth/me", {
      withCredentials: true,
    });
  });

  it("validates the email before calling the API", async () => {
    const post = vi.spyOn(axios, "post");
    mount();
    await screen.findByLabelText(i18n.t("form.email"));
    await user.type(emailInput(), "not-an-email");
    await user.click(screen.getByRole("button", { name: new RegExp(i18n.t("portalAuth.sendCode")) }));
    expect(await screen.findByText(i18n.t("validation.emailInvalid"))).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("requests a code for the right portal and advances to the code step", async () => {
    const post = vi.spyOn(axios, "post").mockResolvedValue({ data: { ok: true, sent: true } });
    mount("contractor");
    await screen.findByLabelText(i18n.t("form.email"));
    await reachCodeStep("  ctr@example.com ");
    expect(post).toHaveBeenCalledWith(
      "/api/contractor/auth/otp/request",
      { email: "ctr@example.com" },
      { withCredentials: true },
    );
    expect(screen.getByText(i18n.t("portalAuth.codeHint", { email: "ctr@example.com" }))).toBeInTheDocument();
    expect(screen.getByRole("group", { name: i18n.t("portalAuth.codeLabel") })).toBeInTheDocument();
  });

  it("shows a pending-approval legend and stays on email when the affiliate is pending", async () => {
    vi.spyOn(axios, "post").mockRejectedValue(axiosError(403, "errors.authPending"));
    mount("affiliate");
    await screen.findByLabelText(i18n.t("form.email"));
    expect(screen.getByText(i18n.t("portalAuth.pendingLegend"))).toBeInTheDocument();
    await user.type(emailInput(), "tonatiuh.gom@gmail.com");
    await user.click(screen.getByRole("button", { name: new RegExp(i18n.t("portalAuth.sendCode")) }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(i18n.t("errors.authPending"));
    expect(alert.className).toContain("portal-login-legend");
    expect(screen.queryByText(i18n.t("portalAuth.codeStep"))).toBeNull();
  });

  it("shows a translated error and stays on the email step when delivery fails (502)", async () => {
    vi.spyOn(axios, "post").mockRejectedValue(axiosError(502, "errors.otpSendFailed"));
    mount();
    await screen.findByLabelText(i18n.t("form.email"));
    await user.type(emailInput(), "pat@example.com");
    await user.click(screen.getByRole("button", { name: new RegExp(i18n.t("portalAuth.sendCode")) }));
    expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("errors.otpSendFailed"));
    expect(screen.queryByText(i18n.t("portalAuth.codeStep"))).toBeNull();
    expect(emailInput()).toBeInTheDocument();
  });

  it("rate limiting surfaces errors.tooMany in the UI language", async () => {
    await i18n.changeLanguage("es");
    vi.spyOn(axios, "post").mockRejectedValue(axiosError(429, "errors.tooMany"));
    mount();
    await screen.findByLabelText(i18n.t("form.email"));
    await user.type(emailInput(), "pat@example.com");
    await user.click(screen.getByRole("button", { name: new RegExp(i18n.t("portalAuth.sendCode")) }));
    expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("errors.tooMany"));
    expect(i18n.t("errors.tooMany")).not.toBe("errors.tooMany");
  });

  it("keeps verify disabled until six digits, then rejects a wrong code", async () => {
    const post = vi.spyOn(axios, "post").mockResolvedValueOnce({ data: { ok: true, sent: true } });
    mount();
    await screen.findByLabelText(i18n.t("form.email"));
    await reachCodeStep();
    await user.type(digitBox(1), "12ab");
    expect(verifyBtn()).toBeDisabled();
    expect(post).toHaveBeenCalledTimes(1); // only the request

    post.mockRejectedValueOnce(axiosError(401, "errors.authInvalid"));
    await user.clear(digitBox(1));
    await user.clear(digitBox(2));
    await user.type(digitBox(1), "123456");
    expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("errors.authInvalid"));
    expect(post).toHaveBeenLastCalledWith(
      "/api/affiliate/auth/otp/verify",
      { email: "pat@example.com", code: "123456" },
      { withCredentials: true },
    );
  });

  it("pasting a 6-digit code auto-verifies and navigates home", async () => {
    const post = vi
      .spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { ok: true, sent: true } })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          actor: "affiliate",
          user: {
            id: 1,
            email: "pat@example.com",
            first_name: "Pat",
            last_name: "A",
            status: "active",
            preferred_language: "en",
          },
        },
      });
    mount();
    await screen.findByLabelText(i18n.t("form.email"));
    await reachCodeStep();
    digitBox(1).focus();
    await user.paste("424242");
    await waitFor(() => expect(screen.getByText("HOME:affiliate")).toBeInTheDocument());
    expect(store.getState().portalAuth.affiliate.user?.email).toBe("pat@example.com");
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenLastCalledWith(
      "/api/affiliate/auth/otp/verify",
      { email: "pat@example.com", code: "424242" },
      { withCredentials: true },
    );
  });

  it("signs in when typing a valid six-digit code (auto-submit)", async () => {
    const post = vi
      .spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { ok: true, sent: true } })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          actor: "affiliate",
          user: {
            id: 1,
            email: "pat@example.com",
            first_name: "Pat",
            last_name: "A",
            status: "active",
            preferred_language: "en",
          },
        },
      });
    mount();
    await screen.findByLabelText(i18n.t("form.email"));
    await reachCodeStep();
    await user.type(digitBox(1), "424242");
    await waitFor(() => expect(screen.getByText("HOME:affiliate")).toBeInTheDocument());
    expect(post).toHaveBeenCalledTimes(2);
  });
});
