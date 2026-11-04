import { createSlice } from "@reduxjs/toolkit";
import type { AffiliateLinkInfo } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Affiliate portal → my link (card, QR, flyer; the link name is staff-only). */
export const fetchAffiliateLink = createApiThunk<AffiliateLinkInfo, void>(
  "affiliateLink/fetch",
  "affiliate",
  async () => (await api.get("/affiliate/link")).data,
);

type State = {
  info: AffiliateLinkInfo | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** Staff: approved affiliates who never received their link. */
  unsent: number | null;
  bulkSending: boolean;
  bulkResult: { sent: number; failed: number } | null;
};
/** Staff: send an approved affiliate their link again; bulk-send to approved affiliates who never got it. */
export const sendAffiliateLinkAdmin = createApiThunk<{ email: boolean; sms: boolean }, number>(
  "affiliateLink/adminSend",
  "admin",
  async (id) => (await api.post(`/admin/affiliates/${id}/send-link`)).data,
);
export const fetchUnsentLinks = createApiThunk<{ count: number }, void>(
  "affiliateLink/unsent",
  "admin",
  async () => (await api.get("/admin/affiliate-links/unsent")).data,
);
export const sendAllAffiliateLinks = createApiThunk<{ sent: number; failed: number }, void>(
  "affiliateLink/sendAll",
  "admin",
  async () => (await api.post("/admin/affiliate-links/send-all", { confirm: true })).data,
);

const initialState: State = { info: null, loading: false, saving: false, error: null, unsent: null, bulkSending: false, bulkResult: null };

const slice = createSlice({
  name: "affiliateLink",
  initialState,
  reducers: {
    clearLinkError(s) {
      s.error = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchAffiliateLink.pending, (s) => {
      s.loading = true;
    })
      .addCase(fetchAffiliateLink.fulfilled, (s, a) => {
        s.loading = false;
        s.info = a.payload;
      })
      .addCase(fetchAffiliateLink.rejected, (s, a) => {
        s.loading = false;
        s.error = a.payload || "errors.server";
      })
      .addCase(fetchUnsentLinks.fulfilled, (s, a) => {
        s.unsent = a.payload.count;
      })
      .addCase(sendAllAffiliateLinks.pending, (s) => {
        s.bulkSending = true;
      })
      .addCase(sendAllAffiliateLinks.fulfilled, (s, a) => {
        s.bulkSending = false;
        s.bulkResult = a.payload;
        s.unsent = 0;
      })
      .addCase(sendAllAffiliateLinks.rejected, (s) => {
        s.bulkSending = false;
      });
  },
});

export const { clearLinkError } = slice.actions;
export default slice.reducer;
