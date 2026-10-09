import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { PersonMatch } from "@shared/api";

/**
 * Last one-role-per-person conflict from any staff mutation (409
 * `errors.personExists` / `errors.personPhoneMatch`). Captured centrally in
 * createApiThunk so every form can render <PersonConflictNotice />.
 */
export type PersonConflict = {
  error: string;
  match: PersonMatch | null;
  canOverride: boolean;
};

const slice = createSlice({
  name: "personConflict",
  initialState: { current: null as PersonConflict | null },
  reducers: {
    personConflictDetected(state, a: PayloadAction<PersonConflict>) {
      state.current = a.payload;
    },
    clearPersonConflict(state) {
      state.current = null;
    },
  },
  extraReducers: (b) => {
    // A new staff create/convert/save attempt replaces any previous conflict.
    b.addMatcher(
      (a: { type: string }) =>
        a.type.endsWith("/pending") &&
        /^(adminMutation|contacts\/convert|conversations\/createProspect)/.test(a.type),
      (state) => {
        state.current = null;
      },
    );
  },
});

export const { personConflictDetected, clearPersonConflict } = slice.actions;
export default slice.reducer;

/** Pull a person conflict out of an API error body (null when it isn't one). */
export function personConflictFromBody(body: unknown): PersonConflict | null {
  const b = body as { error?: string; match?: PersonMatch; can_override?: boolean } | undefined;
  if (!b?.error || !/^errors\.(personExists|personPhoneMatch|emailExists)/.test(b.error)) return null;
  return { error: b.error, match: b.match ?? null, canOverride: b.can_override === true };
}
