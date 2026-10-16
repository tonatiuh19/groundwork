import { describe, expect, it } from "vitest";
import { __test } from "./index";

describe("isEventPast (end of event day, Pacific)", () => {
  // 2026-10-06 19:00 PDT == 2026-10-07 02:00 UTC
  const starts_at = new Date("2026-10-07T02:00:00Z");

  it("stays upcoming through 11:59 PM Pacific on the event day", () => {
    expect(__test.isEventPast({ starts_at }, new Date("2026-10-07T06:59:00Z"))).toBe(false);
  });

  it("is past right after midnight Pacific", () => {
    expect(__test.isEventPast({ starts_at }, new Date("2026-10-07T07:01:00Z"))).toBe(true);
  });

  it("uses ends_at when set (multi-day events)", () => {
    const ends_at = new Date("2026-10-09T02:00:00Z");
    expect(__test.isEventPast({ starts_at, ends_at }, new Date("2026-10-08T12:00:00Z"))).toBe(false);
    expect(__test.isEventPast({ starts_at, ends_at }, new Date("2026-10-09T08:00:00Z"))).toBe(true);
  });

  it("handles standard time (PST, UTC-8) days", () => {
    // 2026-12-05 18:00 PST == 2026-12-06 02:00 UTC; day ends 2026-12-06 08:00 UTC
    const dec = new Date("2026-12-06T02:00:00Z");
    expect(__test.isEventPast({ starts_at: dec }, new Date("2026-12-06T07:59:00Z"))).toBe(false);
    expect(__test.isEventPast({ starts_at: dec }, new Date("2026-12-06T08:01:00Z"))).toBe(true);
  });

  it("closes registration for past events even if registration_closes_at is later", () => {
    const ev = {
      status: "published",
      starts_at: new Date(Date.now() - 3 * 86_400_000),
      registration_opens_at: new Date(Date.now() - 10 * 86_400_000),
      registration_closes_at: new Date(Date.now() + 86_400_000),
    };
    expect(__test.eventRegistrationOpen(ev)).toBe(false);
  });

  it("is never past without dates", () => {
    expect(__test.isEventPast({})).toBe(false);
  });
});

describe("parseEventEmbedUrl", () => {
  it("normalizes YouTube watch / short / youtu.be links", () => {
    for (const u of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    ]) {
      expect(__test.parseEventEmbedUrl(u)).toMatchObject({
        provider: "youtube",
        embed_url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      });
    }
  });

  it("normalizes Instagram reels and posts", () => {
    expect(__test.parseEventEmbedUrl("https://www.instagram.com/reel/C9abcDEF12/?igsh=x")).toMatchObject({
      provider: "instagram",
      embed_url: "https://www.instagram.com/reel/C9abcDEF12/embed",
    });
    expect(__test.parseEventEmbedUrl("https://instagram.com/p/C9abcDEF12/")?.embed_url).toBe(
      "https://www.instagram.com/p/C9abcDEF12/embed",
    );
  });

  it("normalizes TikTok video links", () => {
    expect(
      __test.parseEventEmbedUrl("https://www.tiktok.com/@groundwork/video/7412345678901234567?lang=en"),
    ).toMatchObject({ provider: "tiktok", embed_url: "https://www.tiktok.com/embed/v2/7412345678901234567" });
  });

  it("rejects other hosts, schemes and malformed ids", () => {
    for (const u of [
      "https://evil.example.com/watch?v=dQw4w9WgXcQ",
      "javascript:alert(1)",
      "https://www.youtube.com/watch?v=<script>",
      "https://www.tiktok.com/@x",
      "not a url",
      "",
    ]) {
      expect(__test.parseEventEmbedUrl(u)).toBeNull();
    }
  });
});

describe("detectVideoType", () => {
  const ftyp = (brand: string) =>
    Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftyp"), Buffer.from(brand)]);

  it("sniffs mp4, mov and webm", () => {
    expect(__test.detectVideoType(ftyp("isom"))?.mime).toBe("video/mp4");
    expect(__test.detectVideoType(ftyp("qt  "))?.mime).toBe("video/quicktime");
    expect(__test.detectVideoType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]))?.mime).toBe("video/webm");
  });

  it("rejects non-video bytes", () => {
    expect(__test.detectVideoType(Buffer.from("<html><body>"))).toBeNull();
    expect(__test.detectVideoType(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe("twilioNumberPointsHere (shared Twilio account sync filter)", () => {
  const app = "https://groundworkcapitalgroup.com";
  it("accepts Groundwork webhooks with or without www", () => {
    expect(__test.twilioNumberPointsHere("https://www.groundworkcapitalgroup.com/api/webhooks/twilio/sms", "", app)).toBe(true);
    expect(__test.twilioNumberPointsHere("", "https://groundworkcapitalgroup.com/api/voice/incoming", app)).toBe(true);
  });
  it("skips other brands and disconnected lines", () => {
    expect(__test.twilioNumberPointsHere("https://portal.encoremortgage.org/api/webhooks/inbound-sms", "https://portal.encoremortgage.org/api/voice/incoming", app)).toBe(false);
    expect(__test.twilioNumberPointsHere("", "", app)).toBe(false);
    expect(__test.twilioNumberPointsHere("https://groundworkcapitalgroup.com.evil.example/x", null, app)).toBe(false);
  });
});

describe("twilioNumberPointsHere (shared Twilio account sync filter)", () => {
  const app = "https://groundworkcapitalgroup.com";
  it("accepts Groundwork webhooks with or without www", () => {
    expect(__test.twilioNumberPointsHere("https://www.groundworkcapitalgroup.com/api/webhooks/twilio/sms", "", app)).toBe(true);
    expect(__test.twilioNumberPointsHere("", "https://groundworkcapitalgroup.com/api/voice/incoming", app)).toBe(true);
  });
  it("skips other brands and disconnected lines", () => {
    expect(__test.twilioNumberPointsHere("https://portal.encoremortgage.org/api/webhooks/inbound-sms", "https://portal.encoremortgage.org/api/voice/incoming", app)).toBe(false);
    expect(__test.twilioNumberPointsHere("", "", app)).toBe(false);
    expect(__test.twilioNumberPointsHere("https://groundworkcapitalgroup.com.evil.example/x", null, app)).toBe(false);
  });
});
