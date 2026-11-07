import { afterEach, describe, expect, it } from "vitest";
import { __testSetAssistantApi, aiFactTokens, aiImproveText, aiRewriteKeepsFacts } from "./index";

/** Fake Claude client: returns `reply` and records the request (Vitest never calls the real API). */
const fake = (reply: string, stop = "end_turn") => {
  const calls: any[] = [];
  __testSetAssistantApi({
    beta: {
      messages: {
        create: async (req: any) => {
          calls.push(req);
          return { stop_reason: stop, content: [{ type: "text", text: reply }], usage: {} };
        },
      },
    },
  });
  return calls;
};
afterEach(() => __testSetAssistantApi(null));

describe("Improve with AI: fact guard", () => {
  it("keeps placeholders, links, emails and numbers as the facts of a draft", () => {
    expect(aiFactTokens("Hi {{ first_name }}, call 818-205-6150 or see https://x.com/a. Fee $1,500 on 11/19")).toEqual(
      ["#1119", "#1500", "#8182056150", "https://x.com/a", "{{first_name}}"].sort(),
    );
    expect(aiFactTokens("<p>Write to <a href='#'>ana@example.com</a></p>")).toEqual(["ana@example.com"]);
  });

  it("a rewrite may reword but never add, drop or change a fact", () => {
    const draft = "hi {{first_name}} the event is 11/19 at 6, link https://gw.co/e";
    expect(aiRewriteKeepsFacts(draft, "Hi {{first_name}}! The event is on 11/19 at 6. Details: https://gw.co/e")).toBe(true);
    expect(aiRewriteKeepsFacts(draft, "Hi {{first_name}}! The event is on 11/19 at 6:30. https://gw.co/e")).toBe(false); // changed time
    expect(aiRewriteKeepsFacts(draft, "Hi there! The event is 11/19 at 6. https://gw.co/e")).toBe(false); // dropped placeholder
    expect(aiRewriteKeepsFacts("See you soon", "See you soon, it's only $99!")).toBe(false); // invented price
  });
});

describe("Improve with AI: rewrite", () => {
  it("returns the improved text, cleans long dashes and wrapping quotes, and asks to keep the language", async () => {
    const calls = fake('"Good morning, Brenda! The QR code is ready — you will see every registration."');
    const out = await aiImproveText("Brenda, good morning. QR code ready, you see every registration", "sms");
    expect(out).toBe("Good morning, Brenda! The QR code is ready, you will see every registration.");
    expect(calls[0].system).toMatch(/same language/i);
    expect(calls[0].system).toMatch(/Never add facts/);
  });

  it("refuses a rewrite that changed a fact, a refusal, or a draft that is too short", async () => {
    fake("Hi Ana, the fee is $2,000.");
    await expect(aiImproveText("Hi {{first_name}}, the fee is $1,500.", "sms")).rejects.toMatchObject({ status: 422, key: "errors.aiChangedFacts" });
    fake("", "refusal");
    await expect(aiImproveText("Please rewrite this", "email")).rejects.toMatchObject({ status: 422 });
    await expect(aiImproveText("ok", "sms")).rejects.toMatchObject({ status: 400, key: "errors.aiTextTooShort" });
  });

  it("an API failure is a friendly 503, never a crash", async () => {
    __testSetAssistantApi({ beta: { messages: { create: async () => { throw new Error("network"); } } } });
    await expect(aiImproveText("Please rewrite this", "note")).rejects.toMatchObject({ status: 503, key: "errors.aiUnavailable" });
  });
});
