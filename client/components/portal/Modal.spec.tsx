import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { Modal } from "@/components/portal/Modal";

const user = userEvent.setup();

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

function mount(open = true, onClose = vi.fn()) {
  render(
    <I18nextProvider i18n={i18n}>
      <Modal open={open} titleKey="admin.newProject" onClose={onClose}>
        <p>Modal body</p>
        <button type="button">Action</button>
      </Modal>
    </I18nextProvider>,
  );
  return onClose;
}

describe("portal Modal", () => {
  it("portals a solid dialog into document.body with labelled title", () => {
    mount();
    const dialog = screen.getByTestId("pf-modal");
    expect(dialog).toBeInTheDocument();
    expect(dialog.parentElement).toBe(document.body.querySelector(".pf-modal-backdrop"));
    expect(screen.getByRole("dialog", { name: i18n.t("admin.newProject") })).toBeInTheDocument();
    expect(screen.getByText("Modal body")).toBeInTheDocument();
  });

  it("locks body scroll while open and restores on close", () => {
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <Modal open titleKey="admin.newProject" onClose={() => undefined}>
          <p>open</p>
        </Modal>
      </I18nextProvider>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    rerender(
      <I18nextProvider i18n={i18n}>
        <Modal open={false} titleKey="admin.newProject" onClose={() => undefined}>
          <p>closed</p>
        </Modal>
      </I18nextProvider>,
    );
    expect(document.body.style.overflow).toBe("");
  });

  it("closes on Escape and backdrop click, not panel click", async () => {
    const onClose = mount();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    await user.click(screen.getByTestId("pf-modal"));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("pf-modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the icon button", async () => {
    const onClose = mount();
    await user.click(screen.getByRole("button", { name: i18n.t("pf.close") }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
