import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import axios from "axios";
import type { PortalActor, PortalAuthUser } from "@shared/api";

type PortalState = {
  user: PortalAuthUser | null;
  bootstrapped: boolean;
  loadingMe: boolean;
  requesting: boolean;
  verifying: boolean;
  otpEmail: string | null;
  error: string | null;
};

type State = Record<PortalActor, PortalState>;

const empty = (): PortalState => ({
  user: null,
  bootstrapped: false,
  loadingMe: false,
  requesting: false,
  verifying: false,
  otpEmail: null,
  error: null,
});

const initialState: State = {
  admin: empty(),
  affiliate: empty(),
  contractor: empty(),
  client: empty(),
};

function apiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string } | undefined;
    return data?.error || "errors.server";
  }
  return "errors.server";
}

export const requestPortalOtp = createAsyncThunk(
  "portalAuth/requestOtp",
  async (
    args: { actor: PortalActor; email: string },
    { rejectWithValue },
  ) => {
    try {
      await axios.post(
        `/api/${args.actor}/auth/otp/request`,
        { email: args.email },
        { withCredentials: true },
      );
      return { actor: args.actor, email: args.email };
    } catch (e) {
      return rejectWithValue({ actor: args.actor, error: apiError(e) });
    }
  },
);

export const verifyPortalOtp = createAsyncThunk(
  "portalAuth/verifyOtp",
  async (
    args: { actor: PortalActor; email: string; code: string },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await axios.post(
        `/api/${args.actor}/auth/otp/verify`,
        { email: args.email, code: args.code },
        { withCredentials: true },
      );
      return {
        actor: args.actor,
        user: data.user as PortalAuthUser,
      };
    } catch (e) {
      return rejectWithValue({ actor: args.actor, error: apiError(e) });
    }
  },
);

export const fetchPortalMe = createAsyncThunk(
  "portalAuth/me",
  async (actor: PortalActor, { rejectWithValue }) => {
    try {
      const { data } = await axios.get(`/api/${actor}/auth/me`, {
        withCredentials: true,
      });
      return { actor, user: data.user as PortalAuthUser };
    } catch (e) {
      return rejectWithValue({ actor, error: apiError(e) });
    }
  },
);

export const logoutPortal = createAsyncThunk(
  "portalAuth/logout",
  async (actor: PortalActor) => {
    try {
      await axios.post(
        `/api/${actor}/auth/logout`,
        {},
        { withCredentials: true },
      );
    } catch {
      /* ignore */
    }
    return { actor };
  },
);

const portalAuthSlice = createSlice({
  name: "portalAuth",
  initialState,
  reducers: {
    clearPortalAuthError(state, action: PayloadAction<PortalActor>) {
      state[action.payload].error = null;
    },
    /** A portal API call returned 401 — drop the user so the shell redirects to login. */
    portalSessionExpired(state, action: PayloadAction<PortalActor>) {
      state[action.payload].user = null;
      state[action.payload].bootstrapped = true;
    },
    setPortalUser(
      state,
      action: PayloadAction<{ actor: PortalActor; user: PortalAuthUser }>,
    ) {
      state[action.payload.actor].user = action.payload.user;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(requestPortalOtp.pending, (state, action) => {
        const actor = action.meta.arg.actor;
        state[actor].requesting = true;
        state[actor].error = null;
      })
      .addCase(requestPortalOtp.fulfilled, (state, action) => {
        const { actor, email } = action.payload;
        state[actor].requesting = false;
        state[actor].otpEmail = email;
      })
      .addCase(requestPortalOtp.rejected, (state, action) => {
        const payload = action.payload as
          | { actor: PortalActor; error: string }
          | undefined;
        if (!payload) return;
        state[payload.actor].requesting = false;
        state[payload.actor].error = payload.error;
      })
      .addCase(verifyPortalOtp.pending, (state, action) => {
        const actor = action.meta.arg.actor;
        state[actor].verifying = true;
        state[actor].error = null;
      })
      .addCase(verifyPortalOtp.fulfilled, (state, action) => {
        const { actor, user } = action.payload;
        state[actor].verifying = false;
        state[actor].user = user;
        state[actor].bootstrapped = true;
        state[actor].otpEmail = null;
      })
      .addCase(verifyPortalOtp.rejected, (state, action) => {
        const payload = action.payload as
          | { actor: PortalActor; error: string }
          | undefined;
        if (!payload) return;
        state[payload.actor].verifying = false;
        state[payload.actor].error = payload.error;
      })
      .addCase(fetchPortalMe.pending, (state, action) => {
        state[action.meta.arg].loadingMe = true;
      })
      .addCase(fetchPortalMe.fulfilled, (state, action) => {
        const { actor, user } = action.payload;
        state[actor].loadingMe = false;
        state[actor].bootstrapped = true;
        state[actor].user = user;
      })
      .addCase(fetchPortalMe.rejected, (state, action) => {
        const actor =
          (action.payload as { actor?: PortalActor } | undefined)?.actor ||
          action.meta.arg;
        state[actor].loadingMe = false;
        state[actor].bootstrapped = true;
        state[actor].user = null;
      })
      .addCase(logoutPortal.fulfilled, (state, action) => {
        const actor = action.payload.actor;
        state[actor] = empty();
        state[actor].bootstrapped = true;
      });
  },
});

export const { clearPortalAuthError, portalSessionExpired, setPortalUser } =
  portalAuthSlice.actions;
export default portalAuthSlice.reducer;
