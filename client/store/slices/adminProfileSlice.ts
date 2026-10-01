import type { PortalAuthUser } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

export type AdminProfilePatch = {
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  preferred_language?: "en" | "es";
};

export const updateAdminProfile = createApiThunk<
  PortalAuthUser,
  AdminProfilePatch
>("adminProfile/update", "admin", async (patch) => {
  const { data } = await api.patch<{ user: PortalAuthUser }>("/admin/me", patch);
  return data.user;
});

/** Upload cropped avatar bytes; API stores on Vercel Blob and returns updated user. */
export const uploadAdminAvatar = createApiThunk<
  PortalAuthUser,
  { file: Blob }
>("adminProfile/avatar", "admin", async ({ file }) => {
  const { data } = await api.post<{ user: PortalAuthUser }>(
    "/admin/me/avatar",
    file,
    {
      headers: { "Content-Type": file.type || "image/jpeg" },
      transformRequest: [(data) => data],
    },
  );
  return data.user;
});
