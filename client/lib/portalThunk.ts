import { createAsyncThunk } from "@reduxjs/toolkit";
import axios from "axios";
import type { PortalActor } from "@shared/api";
import { formatAxiosError } from "@/lib/api";
import { portalSessionExpired } from "@/store/slices/portalAuthSlice";
import {
  personConflictDetected,
  personConflictFromBody,
} from "@/store/slices/personConflictSlice";

/**
 * Standard portal thunk: API errors become `rejectWithValue(i18nKey)`, and a
 * 401 mid-session marks the actor's session as expired so the shell redirects
 * to that portal's login.
 */
export function createApiThunk<Ret, Arg = void>(
  type: string,
  actor: PortalActor | null,
  fn: (arg: Arg) => Promise<Ret>,
) {
  return createAsyncThunk<Ret, Arg, { rejectValue: string }>(
    type,
    async (arg, { rejectWithValue, dispatch }) => {
      try {
        return await fn(arg);
      } catch (error) {
        if (actor && axios.isAxiosError(error) && error.response?.status === 401) {
          dispatch(portalSessionExpired(actor));
        }
        // One-role-per-person conflicts carry the matched record for <PersonConflictNotice />.
        if (axios.isAxiosError(error) && error.response?.status === 409) {
          const conflict = personConflictFromBody(error.response.data);
          if (conflict) dispatch(personConflictDetected(conflict));
        }
        return rejectWithValue(formatAxiosError(error, "errors.server"));
      }
    },
  );
}
