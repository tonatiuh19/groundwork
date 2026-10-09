import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import type { AdminDuplicatesResponse, DedupeEntity, DuplicateCluster, PersonEntity } from "@shared/api";
import { api, formatAxiosError } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

export type MergePreview = {
  moves: Record<string, number>;
  blockers: string[];
  warnings: string[];
};
export type DeletePreview = { blockers: string[]; removed_projects: number };

type State = {
  clusters: DuplicateCluster[];
  loading: boolean;
  error: string | null;
  /** Signature of the cluster with an action in flight. */
  busy: string | null;
  actionError: string | null;
  actionBlockers: string[];
  preview: {
    loading: boolean;
    merge: MergePreview | null;
    remove: DeletePreview | null;
    error: string | null;
  };
};

const initialState: State = {
  clusters: [],
  loading: false,
  error: null,
  busy: null,
  actionError: null,
  actionBlockers: [],
  preview: { loading: false, merge: null, remove: null, error: null },
};

export const fetchDuplicates = createApiThunk<AdminDuplicatesResponse, void>(
  "duplicates/fetch",
  "admin",
  async () => (await api.get("/admin/duplicates")).data,
);

type ActionArg = { signature: string };
type Reject = { error: string; blockers?: string[] };

/** All queue actions refresh the list on success and surface `blockers` on 409. */
function action<Arg extends ActionArg, Ret>(name: string, fn: (arg: Arg) => Promise<Ret>) {
  return createAsyncThunk<Ret, Arg, { rejectValue: Reject }>(
    `duplicates/${name}`,
    async (arg, { rejectWithValue, dispatch }) => {
      try {
        const out = await fn(arg);
        void dispatch(fetchDuplicates());
        return out;
      } catch (error) {
        const data = axios.isAxiosError(error) ? (error.response?.data as Reject | undefined) : undefined;
        return rejectWithValue({
          error: data?.error || formatAxiosError(error, "errors.server"),
          blockers: data?.blockers,
        });
      }
    },
  );
}

export const mergeDuplicates = action(
  "merge",
  async (a: ActionArg & { entity: DedupeEntity; keep_id: number; remove_ids: number[]; reason?: string }) => {
    // One survivor, several duplicates: merge them in sequence.
    for (const id of a.remove_ids) {
      await api.post("/admin/duplicates/merge", {
        entity: a.entity,
        keep_id: a.keep_id,
        remove_id: id,
        reason: a.reason || null,
      });
    }
    return true;
  },
);

export const deleteDuplicate = action(
  "delete",
  async (a: ActionArg & { entity: DedupeEntity; id: number; reason?: string }) =>
    (await api.post("/admin/duplicates/delete", { entity: a.entity, id: a.id, reason: a.reason || null })).data,
);

export const dismissDuplicate = action("dismiss", async (a: ActionArg & { reason: string }) =>
  (await api.post("/admin/duplicates/dismiss", { signature: a.signature, reason: a.reason })).data,
);

export const linkLeadToRecord = action(
  "link",
  async (a: ActionArg & { lead_id: number; entity: PersonEntity; id: number }) =>
    (await api.post("/admin/duplicates/link-lead", { lead_id: a.lead_id, entity: a.entity, id: a.id })).data,
);

/** Dry runs (no data changes) — the confirm dialog shows what would move / what blocks. */
export const previewDuplicateMerge = createApiThunk<
  MergePreview,
  { entity: DedupeEntity; keep_id: number; remove_ids: number[] }
>("duplicates/previewMerge", "admin", async (a) => {
  const out: MergePreview = { moves: {}, blockers: [], warnings: [] };
  for (const id of a.remove_ids) {
    const { data } = await api.post("/admin/duplicates/merge", {
      entity: a.entity,
      keep_id: a.keep_id,
      remove_id: id,
      dry_run: true,
    });
    for (const [k, n] of Object.entries((data.moves || {}) as Record<string, number>)) {
      out.moves[k] = (out.moves[k] || 0) + n;
    }
    out.blockers.push(...(data.blockers || []));
    out.warnings.push(...(data.warnings || []));
  }
  out.blockers = [...new Set(out.blockers)];
  out.warnings = [...new Set(out.warnings)];
  return out;
});

export const previewDuplicateDelete = createApiThunk<DeletePreview, { entity: DedupeEntity; id: number }>(
  "duplicates/previewDelete",
  "admin",
  async (a) =>
    (await api.post("/admin/duplicates/delete", { entity: a.entity, id: a.id, dry_run: true })).data,
);

const ACTIONS = [mergeDuplicates, deleteDuplicate, dismissDuplicate, linkLeadToRecord];

const slice = createSlice({
  name: "duplicates",
  initialState,
  reducers: {
    clearDuplicateActionError(state) {
      state.actionError = null;
      state.actionBlockers = [];
      state.preview = initialState.preview;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchDuplicates.pending, (s) => {
      s.loading = true;
      s.error = null;
    })
      .addCase(fetchDuplicates.fulfilled, (s, a) => {
        s.loading = false;
        s.clusters = a.payload.clusters;
      })
      .addCase(fetchDuplicates.rejected, (s, a) => {
        s.loading = false;
        s.error = a.payload || "errors.server";
      });
    b.addCase(previewDuplicateMerge.pending, (s) => {
      s.preview = { ...initialState.preview, loading: true };
    })
      .addCase(previewDuplicateMerge.fulfilled, (s, a) => {
        s.preview = { ...initialState.preview, merge: a.payload };
      })
      .addCase(previewDuplicateMerge.rejected, (s, a) => {
        s.preview = { ...initialState.preview, error: a.payload || "errors.server" };
      })
      .addCase(previewDuplicateDelete.pending, (s) => {
        s.preview = { ...initialState.preview, loading: true };
      })
      .addCase(previewDuplicateDelete.fulfilled, (s, a) => {
        s.preview = { ...initialState.preview, remove: a.payload };
      })
      .addCase(previewDuplicateDelete.rejected, (s, a) => {
        s.preview = { ...initialState.preview, error: a.payload || "errors.server" };
      });
    for (const t of ACTIONS) {
      b.addCase(t.pending, (s, a) => {
        s.busy = a.meta.arg.signature;
        s.actionError = null;
        s.actionBlockers = [];
      })
        .addCase(t.fulfilled, (s) => {
          s.busy = null;
        })
        .addCase(t.rejected, (s, a) => {
          s.busy = null;
          s.actionError = a.payload?.error || "errors.server";
          s.actionBlockers = a.payload?.blockers || [];
        });
    }
  },
});

export const { clearDuplicateActionError } = slice.actions;
export default slice.reducer;
