import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { createApiThunk } from "@/lib/portalThunk";
import { api } from "@/lib/api";
import { logger } from "@/utils/logger";

/**
 * Spam shield (our own, invisible): each public form gets a signed single-use challenge from
 * `/public/shield/challenge` and solves a small proof-of-work puzzle in the background while the person
 * types. Submit thunks wrap their body with `withShield(form, body)`; `<SpamShieldTrap form>` renders
 * the hidden trap field and primes the challenge when the form opens.
 */
export type ShieldForm = "lead" | "contact" | "enroll" | "client_signup" | "affiliate_signup" | "contractor_signup" | "partner_referral" | "booking";
type Ready = { token: string; solution: string; at: number };

const pending = new Map<ShieldForm, Promise<Ready | null>>();
const traps = new Map<ShieldForm, () => string>();
const REFRESH_MS = 60 * 60 * 1000; // tokens live 2 h on the server; refresh hourly while the page is open

/** Leading zero bits of a hex hash (same rule as the server). */
export function leadingZeroBits(hex: string): number {
  let bits = 0;
  for (const ch of hex) {
    const v = parseInt(ch, 16);
    if (v === 0) {
      bits += 4;
      continue;
    }
    return bits + (Math.clz32(v) - 28);
  }
  return bits;
}

/** Find `solution` so sha256(`${nonce}:${solution}`) starts with `difficulty` zero bits. Yields to the page every batch. */
export async function solveShieldPuzzle(nonce: string, difficulty: number): Promise<string> {
  const enc = new TextEncoder();
  for (let i = 0; i < 50_000_000; i++) {
    const buf = await crypto.subtle.digest("SHA-256", enc.encode(`${nonce}:${i}`));
    const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    if (leadingZeroBits(hex) >= difficulty) return String(i);
    if (i % 2000 === 1999) await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("shield puzzle not solved");
}

async function loadChallenge(form: ShieldForm): Promise<Ready | null> {
  try {
    const { data } = await api.get<{ token: string; nonce: string; difficulty: number }>("/public/shield/challenge", { params: { form } });
    const solution = await solveShieldPuzzle(data.nonce, data.difficulty);
    return { token: data.token, solution, at: Date.now() };
  } catch (e) {
    // The form still submits; the server counts a missing token (and blocks it once the grace period ends).
    logger.warn("spamShield", e);
    return null;
  }
}

function prime(form: ShieldForm): Promise<Ready | null> {
  const p = loadChallenge(form);
  pending.set(form, p);
  return p;
}

/** Form opened: fetch + solve in the background (kept fresh while the page stays open). */
export const primeShield = createAsyncThunk("spamShield/prime", async (form: ShieldForm) => {
  const cur = pending.get(form);
  const ready = cur ? await cur : null;
  if (!cur || !ready || Date.now() - ready.at > REFRESH_MS) await prime(form);
  return true;
});

export function registerShieldTrap(form: ShieldForm, read: () => string): () => void {
  traps.set(form, read);
  return () => {
    if (traps.get(form) === read) traps.delete(form);
  };
}

/**
 * Attach `_shield` to a public form body. Each token is single-use, so the next submit gets a fresh one
 * (primed right away). Pass `keep: true` when the server may answer "confirm with a code" and the same
 * token must be sent again.
 */
export async function withShield<T extends object>(form: ShieldForm, body: T, opts: { keep?: boolean } = {}): Promise<T & { _shield: { token: string; solution: string; hp: string } | undefined }> {
  let ready = await (pending.get(form) ?? prime(form));
  if (ready && Date.now() - ready.at > REFRESH_MS) ready = await prime(form);
  const hp = traps.get(form)?.() ?? "";
  if (!opts.keep) void prime(form);
  return { ...body, _shield: ready ? { token: ready.token, solution: ready.solution, hp } : hp ? { token: "", solution: "", hp } : undefined };
}

/** After a "needs code" reply was handled (booking done or abandoned), start a fresh challenge. */
export function resetShield(form: ShieldForm) {
  void prime(form);
}

// ── Staff: Settings → Spam shield (last 30 days) ──
export type SpamShieldLog = {
  totals: Array<{ form: string; verdict: "blocked" | "quarantined" | "code"; count: number }>;
  recent: Array<{ id: number; form: string; verdict: "blocked" | "quarantined" | "code"; reasons: string[]; score: number; contact: string | null; at: string | null }>;
};
export const fetchSpamShieldLog = createApiThunk<SpamShieldLog, void>("spamShield/log", "admin", async () => (await api.get("/admin/spam-shield")).data);

const slice = createSlice({
  name: "spamShield",
  initialState: { log: null as SpamShieldLog | null, loading: false, error: null as string | null },
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchSpamShieldLog.pending, (s) => {
      s.loading = true;
      s.error = null;
    })
      .addCase(fetchSpamShieldLog.fulfilled, (s, a) => {
        s.loading = false;
        s.log = a.payload;
      })
      .addCase(fetchSpamShieldLog.rejected, (s, a) => {
        s.loading = false;
        s.error = (a.payload as string) || "errors.server";
      });
  },
});
export default slice.reducer;
