import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import type { Call } from "@twilio/voice-sdk";
import i18n from "@/i18n";
import CallKeypad from "@/components/admin/CallKeypad";

afterEach(cleanup);

/** Minimal Twilio Call stand-in: status + sendDigits + accept/disconnect events. */
function fakeCall(status: "pending" | "open") {
  const listeners: Record<string, Array<() => void>> = {};
  const call = {
    _status: status,
    status() {
      return this._status;
    },
    sendDigits: vi.fn(),
    on(ev: string, fn: () => void) {
      (listeners[ev] ||= []).push(fn);
    },
    removeListener(ev: string, fn: () => void) {
      listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn);
    },
    emit(ev: string) {
      (listeners[ev] || []).forEach((f) => f());
    },
  };
  return call;
}

const mount = (call: ReturnType<typeof fakeCall>) =>
  render(
    <I18nextProvider i18n={i18n}>
      <CallKeypad call={call as unknown as Call} />
    </I18nextProvider>,
  );

describe("in-call keypad (DTMF)", () => {
  it("sends each tapped key and shows what was dialed", async () => {
    const call = fakeCall("open");
    mount(call);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "#" }));
    expect(call.sendDigits).toHaveBeenNthCalledWith(1, "1");
    expect(call.sendDigits).toHaveBeenNthCalledWith(2, "#");
    expect(screen.getByRole("status").textContent).toContain("1#");
  });

  it("types on the keyboard and sends a whole extension (commas become waits)", async () => {
    const call = fakeCall("open");
    mount(call);
    const user = userEvent.setup();
    await user.keyboard("5");
    expect(call.sendDigits).toHaveBeenCalledWith("5");
    await user.type(screen.getByRole("textbox"), ",123#");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(call.sendDigits).toHaveBeenLastCalledWith("w123#");
  });

  it("is disabled until the call connects, then unlocks", async () => {
    const call = fakeCall("pending");
    mount(call);
    expect(screen.getByRole("button", { name: "5" })).toBeDisabled();
    act(() => {
      call._status = "open";
      call.emit("accept");
    });
    expect(screen.getByRole("button", { name: "5" })).toBeEnabled();
  });
});
