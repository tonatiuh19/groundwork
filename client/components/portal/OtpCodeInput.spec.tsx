import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import OtpCodeInput from "./OtpCodeInput";

const user = userEvent.setup();

afterEach(() => cleanup());

function Harness({
  verifying = false,
  onComplete,
}: {
  verifying?: boolean;
  onComplete?: (code: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <I18nextProvider i18n={i18n}>
      <OtpCodeInput
        label="One-time code"
        value={value}
        verifying={verifying}
        onChange={setValue}
        onComplete={onComplete}
      />
    </I18nextProvider>
  );
}

const digit1 = () =>
  screen.getByLabelText(i18n.t("portalAuth.digitOf", { current: 1, total: 6 }));

describe("OtpCodeInput", () => {
  it("spreads typed digits across boxes and completes at six", async () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    await user.type(digit1(), "424242");
    expect(onComplete).toHaveBeenCalledWith("424242");
  });

  it("pastes a full code and completes", async () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    digit1().focus();
    await user.paste("998877");
    expect(onComplete).toHaveBeenCalledWith("998877");
  });

  it("shows the verifying loader overlay", () => {
    render(<Harness verifying />);
    expect(screen.getByText(i18n.t("portalAuth.verifying"))).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "One-time code" }),
    ).toHaveAttribute("aria-busy", "true");
  });
});
