import { createSlice } from "@reduxjs/toolkit";
import type { AffiliateAssistantMessage, AffiliateFaq, AffiliateFaqBody } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Affiliate help: FAQ (portal + admin editor) and the assistant chat. */

// ── Affiliate portal / welcome link ──────────────────────────────────────────
export const fetchAffiliateFaqs = createApiThunk<{ faqs: AffiliateFaq[] }, void>(
  "affiliateHelp/faqs",
  "affiliate",
  async () => (await api.get("/affiliate/faqs")).data,
);

export const fetchAssistantHistory = createApiThunk<{ enabled: boolean; messages: AffiliateAssistantMessage[] }, void>(
  "affiliateHelp/history",
  "affiliate",
  async () => (await api.get("/affiliate/assistant")).data,
);

export const askAssistant = createApiThunk<{ reply: string; handoff: boolean }, { message: string; lang: "en" | "es" }>(
  "affiliateHelp/ask",
  "affiliate",
  async (body) => (await api.post("/affiliate/assistant", body)).data,
);

// ── Admin FAQ editor ─────────────────────────────────────────────────────────
export const fetchAdminFaqs = createApiThunk<{ faqs: AffiliateFaq[] }, void>(
  "affiliateHelp/adminFaqs",
  "admin",
  async () => (await api.get("/admin/affiliate-faqs")).data,
);

export const saveAdminFaq = createApiThunk<{ faqs: AffiliateFaq[] }, { id: number | null; body: AffiliateFaqBody }>(
  "affiliateHelp/saveFaq",
  "admin",
  async ({ id, body }) =>
    (id ? await api.put(`/admin/affiliate-faqs/${id}`, body) : await api.post("/admin/affiliate-faqs", body)).data,
);

export const deleteAdminFaq = createApiThunk<{ faqs: AffiliateFaq[] }, number>(
  "affiliateHelp/deleteFaq",
  "admin",
  async (id) => (await api.delete(`/admin/affiliate-faqs/${id}`)).data,
);

export const fetchAdminAssistantLog = createApiThunk<{ messages: AffiliateAssistantMessage[] }, number>(
  "affiliateHelp/adminLog",
  "admin",
  async (id) => (await api.get(`/admin/affiliates/${id}/assistant`)).data,
);

type State = {
  faqs: AffiliateFaq[];
  faqsLoading: boolean;
  messages: AffiliateAssistantMessage[];
  assistantEnabled: boolean;
  asking: boolean;
  askError: string | null;
  adminFaqs: AffiliateFaq[];
  adminSaving: boolean;
  adminError: string | null;
  adminLog: AffiliateAssistantMessage[];
  adminLogFor: number | null;
};

const initialState: State = {
  faqs: [],
  faqsLoading: false,
  messages: [],
  assistantEnabled: true,
  asking: false,
  askError: null,
  adminFaqs: [],
  adminSaving: false,
  adminError: null,
  adminLog: [],
  adminLogFor: null,
};

let tempId = -1;

const slice = createSlice({
  name: "affiliateHelp",
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchAffiliateFaqs.pending, (s) => {
      s.faqsLoading = true;
    })
      .addCase(fetchAffiliateFaqs.fulfilled, (s, a) => {
        s.faqsLoading = false;
        s.faqs = a.payload.faqs;
      })
      .addCase(fetchAffiliateFaqs.rejected, (s) => {
        s.faqsLoading = false;
      })
      .addCase(fetchAssistantHistory.fulfilled, (s, a) => {
        s.messages = a.payload.messages;
        s.assistantEnabled = a.payload.enabled;
      })
      // Show the question right away; the reply replaces the typing state.
      .addCase(askAssistant.pending, (s, a) => {
        s.asking = true;
        s.askError = null;
        s.messages.push({ id: tempId--, role: "user", content: a.meta.arg.message, handoff: false, created_at: new Date().toISOString() });
      })
      .addCase(askAssistant.fulfilled, (s, a) => {
        s.asking = false;
        s.messages.push({ id: tempId--, role: "assistant", content: a.payload.reply, handoff: a.payload.handoff, created_at: new Date().toISOString() });
      })
      .addCase(askAssistant.rejected, (s, a) => {
        s.asking = false;
        s.askError = a.payload || "errors.server";
      })
      .addCase(fetchAdminFaqs.fulfilled, (s, a) => {
        s.adminFaqs = a.payload.faqs;
      })
      .addCase(fetchAdminAssistantLog.fulfilled, (s, a) => {
        s.adminLog = a.payload.messages;
        s.adminLogFor = a.meta.arg;
      });
    for (const t of [saveAdminFaq, deleteAdminFaq]) {
      b.addCase(t.pending, (s) => {
        s.adminSaving = true;
        s.adminError = null;
      })
        .addCase(t.fulfilled, (s, a) => {
          s.adminSaving = false;
          s.adminFaqs = a.payload.faqs;
        })
        .addCase(t.rejected, (s, a) => {
          s.adminSaving = false;
          s.adminError = a.payload || "errors.server";
        });
    }
  },
});

export default slice.reducer;
