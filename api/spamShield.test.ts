import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { issueShieldChallenge, leadingZeroBits, looksGibberish, SHIELD_DIFFICULTY, shieldTexts, shieldVerdict, type ShieldForm } from "./index";

/** Spam shield rules (pure): bots, borderline scoring, and real people (incl. Spanish names) passing. */
const solve = (nonce: string) => {
  for (let i = 0; ; i++) {
    if (leadingZeroBits(crypto.createHash("sha256").update(`${nonce}:${i}`).digest("hex")) >= SHIELD_DIFFICULTY) return String(i);
  }
};
const now = Date.parse("2026-12-01T18:00:00Z"); // after the grace period
const human = (form: ShieldForm, ageMs = 40_000, extra: Record<string, unknown> = {}) => {
  const c = issueShieldChallenge(form, now - ageMs);
  return { token: c.token, solution: solve(c.nonce), hp: "", ...extra };
};
const v = (form: ShieldForm, shield: unknown, texts: string[] = ["Ana Lopez"], phoneOnly = false) => shieldVerdict({ form, shield, texts, phoneOnly, now });

describe("spam shield verdict", () => {
  it("a real person passes, English and Spanish", () => {
    expect(v("lead", human("lead"), ["María José Hernández", "123 Calle Ñandú, Fontana", "Quiero construir un ADU en mi patio"]).verdict).toBe("ok");
    expect(v("booking", human("booking"), ["Marcelino Serna"], true)).toMatchObject({ verdict: "ok", reasons: ["phone_only"] });
  });

  it("clear bots are blocked", () => {
    expect(v("lead", human("lead", 40_000, { hp: "https://spam.example" })).reasons).toContain("trap_field");
    expect(v("lead", undefined).reasons).toContain("no_token");
    expect(v("lead", { ...human("lead"), token: human("lead").token.replace(/.$/, "0") }).verdict).toBe("bot");
    expect(v("contact", human("lead")).reasons).toContain("wrong_form");
    expect(v("lead", human("lead", 3 * 60 * 60 * 1000)).reasons).toContain("expired_token");
    expect(v("lead", { ...human("lead"), solution: "nope" }).reasons).toContain("no_proof");
    expect(v("lead", human("lead", 500)).reasons).toContain("too_fast");
  });

  it("before the grace period ends, a missing token only counts as a hint", () => {
    expect(shieldVerdict({ form: "lead", shield: undefined, texts: ["Ana Lopez"], now: Date.parse("2026-11-19T00:00:00Z") })).toMatchObject({ verdict: "ok", reasons: ["no_token"] });
  });

  it("borderline adds up to suspect: very fast + phone only, links, gibberish", () => {
    expect(v("booking", human("booking", 2500), ["Ana Lopez"], true)).toMatchObject({ verdict: "suspect", reasons: ["fast", "phone_only"] });
    expect(v("booking", human("booking", 2500), ["Ana Lopez"], false).verdict).toBe("ok");
    expect(v("contact", human("contact"), ["Bob", "cheap meds http://x.ru and www.spam.xyz"]).reasons).toContain("links");
    // Gibberish alone is only a hint (one odd name never quarantines a real person); with a link it is suspect.
    expect(v("lead", human("lead"), ["XgTqLpWzrK Bvcxzqwr"])).toMatchObject({ verdict: "ok", reasons: ["gibberish"] });
    expect(v("lead", human("lead"), ["XgTqLpWzrK", "visit http://x.ru"]).verdict).toBe("suspect");
  });

  it("a real form body: email, phone and website fields are not counted as links", () => {
    const body = { full_name: "Ana Lopez", email: "ana.lopez@gmail.com", phone: "(909) 555-0134", website: "https://anarealty.com", notes: "Call me after 5", preferred_language: "es", referral_code: "ABC123" };
    expect(shieldTexts(body)).toEqual(["Ana Lopez", "Call me after 5"]);
    expect(v("affiliate_signup", human("affiliate_signup", 2500), shieldTexts(body)).verdict).toBe("ok");
  });

  it("gibberish check leaves real names alone", () => {
    for (const name of ["Schwarzkopf", "Nguyen Thi Huong", "Krzysztof Wójcik", "Guadalupe Ramírez", "McDonald", "O'Brien-Smith"]) expect(looksGibberish(name)).toBe(false);
    expect(looksGibberish("qwrtzpkls")).toBe(true);
    expect(looksGibberish("aSdFgHjKlQ")).toBe(true);
  });
});
