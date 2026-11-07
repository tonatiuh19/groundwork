import { createSlice } from "@reduxjs/toolkit";
import type { AiImproveKind } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Improve with AI: the server rewrites a staff draft (never sends it, never invents facts). */
export const improveDraft = createApiThunk("aiWrite/improve", "admin", async (a: { text: string; kind: AiImproveKind }) =>
  (await api.post<{ text: string }>("/admin/ai/improve-text", a)).data.text,
);

const UNAVAILABLE_KEY = "gw_ai_unavailable";
const readUnavailable = () => {
  try {
    return window.sessionStorage.getItem(UNAVAILABLE_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * `unavailable`: the AI isn't set up (no / invalid key). Every composer then shows "Coming soon" instead
 * of calling again; remembered for this browser session (a new session tries once more).
 */
type State = { busy: number; unavailable: boolean };
const aiWriteSlice = createSlice({
  name: "aiWrite",
  initialState: (): State => ({ busy: 0, unavailable: typeof window !== "undefined" && readUnavailable() }),
  reducers: {},
  extraReducers: (b) =>
    b
      .addCase(improveDraft.pending, (s) => {
        s.busy += 1;
      })
      .addCase(improveDraft.fulfilled, (s) => {
        s.busy = Math.max(0, s.busy - 1);
        s.unavailable = false;
      })
      .addCase(improveDraft.rejected, (s, a) => {
        s.busy = Math.max(0, s.busy - 1);
        if (a.payload === "errors.aiUnavailable") {
          s.unavailable = true;
          try {
            window.sessionStorage.setItem(UNAVAILABLE_KEY, "1");
          } catch {
            /* storage unavailable */
          }
        }
      }),
});
export default aiWriteSlice.reducer;
