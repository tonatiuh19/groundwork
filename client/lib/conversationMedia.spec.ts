import { describe, expect, it } from "vitest";
import {
  classifyConversationMedia,
  conversationMediaDisplayUrl,
} from "./conversationMedia";

describe("classifyConversationMedia", () => {
  it("detects images", () => {
    expect(classifyConversationMedia("x.jpg", "image/jpeg")).toBe("image");
    expect(classifyConversationMedia("https://cdn/x.PNG", "")).toBe("image");
  });
  it("detects video audio pdf file", () => {
    expect(classifyConversationMedia("a.mp4", "video/mp4")).toBe("video");
    expect(classifyConversationMedia("a.mp3", "audio/mpeg")).toBe("audio");
    expect(classifyConversationMedia("a.pdf", "application/pdf")).toBe("pdf");
    expect(classifyConversationMedia("a.bin", "application/octet-stream")).toBe(
      "file",
    );
  });
});

describe("conversationMediaDisplayUrl", () => {
  it("proxies Twilio API media and leaves Blob URLs alone", () => {
    const twilio =
      "https://api.twilio.com/2010-04-01/Accounts/ACxx/Recordings/RExx.mp3";
    expect(conversationMediaDisplayUrl(twilio)).toBe(
      `/api/conversations/media?url=${encodeURIComponent(twilio)}`,
    );
    const blob = "https://public.blob.vercel-storage.com/conversations/mms/x.jpg";
    expect(conversationMediaDisplayUrl(blob)).toBe(blob);
  });
});
