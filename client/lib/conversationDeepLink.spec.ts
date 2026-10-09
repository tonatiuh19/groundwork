import { describe, expect, it } from "vitest";
import {
  conversationsComposeUrl,
  conversationsDialUrl,
} from "./conversationDeepLink";

describe("conversationDeepLink", () => {
  it("builds compose URL with phone and optional name", () => {
    expect(
      conversationsComposeUrl({ phone: "+15551234567", name: "Ada Lopez" }),
    ).toBe(
      "/admin/conversations?compose=1&phone=%2B15551234567&name=Ada+Lopez",
    );
    expect(conversationsComposeUrl({ phone: " 5551234567 " })).toBe(
      "/admin/conversations?compose=1&phone=5551234567",
    );
  });

  it("builds dial URL with phone only", () => {
    expect(conversationsDialUrl({ phone: "+15551234567" })).toBe(
      "/admin/conversations?dial=1&phone=%2B15551234567",
    );
  });

  it("omits blank names and trims whitespace", () => {
    expect(
      conversationsComposeUrl({ phone: "  +1 555 ", name: "   " }),
    ).toBe("/admin/conversations?compose=1&phone=%2B1+555");
    expect(
      conversationsComposeUrl({ phone: "555", name: null }),
    ).toBe("/admin/conversations?compose=1&phone=555");
  });
});

