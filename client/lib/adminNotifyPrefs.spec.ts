import { describe, expect, it } from "vitest";
import {
  ADMIN_NOTIFY_EVENT_KEYS,
  adminNotifyChannelMasterOn,
  applyAdminNotifyPrefsPatch,
  defaultAdminNotificationPrefs,
  NOTIFY_EXTRA_EVENT_KEYS,
  notifyExtraAllowsEvent,
  toggleNotifyExtraEvent,
} from "./adminNotifyPrefs";

describe("adminNotifyPrefs", () => {
  it("treats null events as all types on", () => {
    expect(notifyExtraAllowsEvent(null, "lead_submitted")).toBe(true);
    expect(notifyExtraAllowsEvent(undefined, "inbound_sms")).toBe(true);
  });

  it("respects a selected subset", () => {
    expect(notifyExtraAllowsEvent(["client_created"], "client_created")).toBe(
      true,
    );
    expect(notifyExtraAllowsEvent(["client_created"], "draw_submitted")).toBe(
      false,
    );
  });

  it("collapses a full catalog toggle-on to null (all types)", () => {
    const almost = NOTIFY_EXTRA_EVENT_KEYS.filter((k) => k !== "inbound_sms");
    expect(toggleNotifyExtraEvent(almost, "inbound_sms", true)).toBeNull();
  });

  it("turns off one type from all-on into a subset", () => {
    const next = toggleNotifyExtraEvent(null, "inbound_sms", false);
    expect(next).not.toBeNull();
    expect(next).not.toContain("inbound_sms");
    expect(next!.length).toBe(NOTIFY_EXTRA_EVENT_KEYS.length - 1);
  });

  it("applies channel master off for optimistic UI", () => {
    const prefs = defaultAdminNotificationPrefs();
    const next = applyAdminNotifyPrefsPatch(prefs, {
      channel_masters: { email: false },
    });
    expect(adminNotifyChannelMasterOn(next, "email")).toBe(false);
    expect(ADMIN_NOTIFY_EVENT_KEYS.every((k) => next.email[k] === false)).toBe(
      true,
    );
    expect(adminNotifyChannelMasterOn(next, "in_app")).toBe(true);
  });

  it("merges a single email event patch", () => {
    const prefs = defaultAdminNotificationPrefs();
    const next = applyAdminNotifyPrefsPatch(prefs, {
      email: { inbound_sms: false },
    });
    expect(next.email.inbound_sms).toBe(false);
    expect(next.email.lead_submitted).toBe(true);
  });

  it("merges in_app and sms event patches", () => {
    const prefs = defaultAdminNotificationPrefs();
    const next = applyAdminNotifyPrefsPatch(prefs, {
      in_app: { draw_submitted: false },
      sms: { inbound_sms: false },
    });
    expect(next.in_app.draw_submitted).toBe(false);
    expect(next.sms.inbound_sms).toBe(false);
    expect(next.in_app.lead_submitted).toBe(true);
    expect(next.sms.lead_submitted).toBe(true);
  });
});
