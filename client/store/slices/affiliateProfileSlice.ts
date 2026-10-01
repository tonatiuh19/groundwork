import type { AffiliateProfile, PortalAuthUser } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

export type AffiliateProfilePatch = {
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  company?: string | null;
  preferred_language?: "en" | "es";
  bio?: string | null;
};

export const fetchAffiliateProfile = createApiThunk<AffiliateProfile, void>(
  "affiliateProfile/fetch",
  "affiliate",
  async () => {
    const { data } = await api.get<{ profile: AffiliateProfile }>("/affiliate/me");
    return data.profile;
  },
);

export const updateAffiliateProfile = createApiThunk<
  { user: PortalAuthUser; profile: AffiliateProfile },
  AffiliateProfilePatch
>("affiliateProfile/update", "affiliate", async (patch) => {
  const { data } = await api.patch<{
    user: PortalAuthUser;
    profile: AffiliateProfile;
  }>("/affiliate/me", patch);
  return data;
});

export const uploadAffiliateAvatar = createApiThunk<PortalAuthUser, { file: Blob }>(
  "affiliateProfile/avatar",
  "affiliate",
  async ({ file }) => {
    const { data } = await api.post<{ user: PortalAuthUser }>(
      "/affiliate/me/avatar",
      file,
      {
        headers: { "Content-Type": file.type || "image/jpeg" },
        transformRequest: [(data) => data],
      },
    );
    return data.user;
  },
);
