import { createSlice } from "@reduxjs/toolkit";
import type {
  AdminLegalResponse,
  LegalDraftBody,
  LegalPendingResponse,
  LegalSlug,
  LegalStatusResponse,
  LegalVersion,
  PublicLegalPage,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Legal pages: public pages, signup checkbox status, member re-acceptance and the admin editor. */

export const fetchLegalPage = createApiThunk<PublicLegalPage, { slug: LegalSlug; lang: "en" | "es" }>(
  "legal/page",
  null,
  async ({ slug, lang }) => (await api.get(`/public/legal/${slug}`, { params: { lang } })).data,
);
export const fetchLegalStatus = createApiThunk<LegalStatusResponse, void>("legal/status", null, async () => (await api.get("/public/legal-status")).data);

export const fetchLegalPending = createApiThunk<LegalPendingResponse, "affiliate" | "contractor">(
  "legal/pending",
  null,
  async (actor) => (await api.get(`/${actor}/legal/pending`)).data,
);
export const acceptLegal = createApiThunk<LegalPendingResponse, "affiliate" | "contractor">(
  "legal/accept",
  null,
  async (actor) => (await api.post(`/${actor}/legal/accept`, { accept: true })).data,
);

export const fetchAdminLegal = createApiThunk<AdminLegalResponse, void>("legal/admin", "admin", async () => (await api.get("/admin/legal")).data);
export const startLegalDraft = createApiThunk<{ ok: true }, LegalSlug>("legal/startDraft", "admin", async (slug) => (await api.post(`/admin/legal/${slug}/draft`)).data);
export const saveLegalDraft = createApiThunk<{ ok: true }, { slug: LegalSlug; body: LegalDraftBody }>(
  "legal/saveDraft",
  "admin",
  async ({ slug, body }) => (await api.put(`/admin/legal/${slug}/draft`, body)).data,
);
export const publishLegal = createApiThunk<{ ok: true }, { slug: LegalSlug; effective_date: string; requires_reacceptance: boolean; notify_members: boolean }>(
  "legal/publish",
  "admin",
  async ({ slug, ...body }) => (await api.post(`/admin/legal/${slug}/publish`, body)).data,
);
export const fetchLegalVersion = createApiThunk<{ ok: true; version: LegalVersion }, { slug: LegalSlug; version: number }>(
  "legal/version",
  "admin",
  async ({ slug, version }) => (await api.get(`/admin/legal/${slug}/${version}`)).data,
);

type State = {
  pages: Record<string, PublicLegalPage>;
  pageLoading: boolean;
  pageError: string | null;
  status: LegalStatusResponse["versions"] | null;
  /** Bumped when a signup is refused with validation.acceptTerms (forms re-check and show the checkbox). */
  statusNonce: number;
  pending: LegalPendingResponse["pending"] | null;
  accepting: boolean;
  admin: AdminLegalResponse | null;
  adminBusy: boolean;
  adminError: string | null;
};
const initialState: State = { pages: {}, pageLoading: false, pageError: null, status: null, statusNonce: 0, pending: null, accepting: false, admin: null, adminBusy: false, adminError: null };

const slice = createSlice({
  name: "legal",
  initialState,
  reducers: {
    clearLegalAdminError: (s) => {
      s.adminError = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchLegalPage.pending, (s) => {
      s.pageLoading = true;
      s.pageError = null;
    })
      .addCase(fetchLegalPage.fulfilled, (s, a) => {
        s.pageLoading = false;
        s.pages[`${a.payload.slug}:${a.payload.lang}`] = a.payload;
      })
      .addCase(fetchLegalPage.rejected, (s, a) => {
        s.pageLoading = false;
        s.pageError = a.payload || "errors.server";
      })
      .addCase(fetchLegalStatus.fulfilled, (s, a) => {
        s.status = a.payload.versions;
      })
      .addCase(fetchLegalPending.fulfilled, (s, a) => {
        s.pending = a.payload.pending;
      })
      .addCase(acceptLegal.pending, (s) => {
        s.accepting = true;
      })
      .addCase(acceptLegal.fulfilled, (s, a) => {
        s.accepting = false;
        s.pending = a.payload.pending;
      })
      .addCase(acceptLegal.rejected, (s) => {
        s.accepting = false;
      })
      .addCase(fetchAdminLegal.fulfilled, (s, a) => {
        s.admin = a.payload;
      })
      .addCase(fetchAdminLegal.rejected, (s, a) => {
        s.adminError = a.payload || "errors.server";
      });
    for (const th of [startLegalDraft, saveLegalDraft, publishLegal] as const) {
      b.addCase(th.pending, (s) => {
        s.adminBusy = true;
        s.adminError = null;
      })
        .addCase(th.fulfilled, (s) => {
          s.adminBusy = false;
        })
        .addCase(th.rejected, (s, a) => {
          s.adminBusy = false;
          s.adminError = a.payload || "errors.server";
        });
    }
    // Any request refused because the Terms must be accepted: the Terms just went live, re-check.
    b.addMatcher(
      (a): a is { type: string; payload: string } => a.type.endsWith("/rejected") && (a as { payload?: unknown }).payload === "validation.acceptTerms",
      (s) => {
        s.statusNonce += 1;
      },
    );
  },
});

export const { clearLegalAdminError } = slice.actions;
export default slice.reducer;
