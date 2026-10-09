import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { ConfirmStatusChangeModal } from "@/components/portal/ConfirmStatusChangeModal";

const user = userEvent.setup();

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("ConfirmStatusChangeModal", () => {
  it("renders demote copy and fires confirm/cancel", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ConfirmStatusChangeModal
          pending={{
            id: 7,
            name: "Ada Lopez",
            from: "active",
            to: "suspended",
          }}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </I18nextProvider>,
    );

    expect(
      screen.getByRole("dialog", { name: i18n.t("admin.demoteStatusTitle") }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ada Lopez/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(i18n.t("accountStatus.suspended"), "i")),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: i18n.t("pf.cancel") }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole("button", { name: i18n.t("admin.demoteStatusConfirm") }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables actions while busy and blocks dismiss", async () => {
    const onCancel = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <ConfirmStatusChangeModal
          pending={{
            id: 1,
            name: "Staff",
            from: "active",
            to: "inactive",
          }}
          busy
          onCancel={onCancel}
          onConfirm={vi.fn()}
        />
      </I18nextProvider>,
    );

    expect(
      screen.getByRole("button", { name: i18n.t("pf.cancel") }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: i18n.t("admin.demoteStatusConfirm") }),
    ).toBeDisabled();

    await user.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("renders nothing actionable when pending is null", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ConfirmStatusChangeModal
          pending={null}
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
