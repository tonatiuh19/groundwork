import { createSlice } from "@reduxjs/toolkit";
import type { AffiliateLinkInfo } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Affiliate portal → my link (card, QR, flyer, link name). */
export const fetchAffiliateLink = createApiThunk<AffiliateLinkInfo, void>(
  "affiliateLink/fetch",
  "affiliate",
  async () => (await api.get("/affiliate/link")).data,
);

export const saveAffiliateSlug = createApiThunk<AffiliateLinkInfo, string>(
  "affiliateLink/slug",
  "affiliate",
  async (slug) => (await api.patch("/affiliate/link", { slug })).data,
);

type State = { info: AffiliateLinkInfo | null; loading: boolean; saving: boolean; error: string | null };
const initialState: State = { info: null, loading: false, saving: false, error: null };

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
      .addCase(saveAffiliateSlug.pending, (s) => {
        s.saving = true;
        s.error = null;
      })
      .addCase(saveAffiliateSlug.fulfilled, (s, a) => {
        s.saving = false;
        s.info = a.payload;
      })
      .addCase(saveAffiliateSlug.rejected, (s, a) => {
        s.saving = false;
        s.error = a.payload || "errors.server";
      });
  },
});

export const { clearLinkError } = slice.actions;
export default slice.reducer;
