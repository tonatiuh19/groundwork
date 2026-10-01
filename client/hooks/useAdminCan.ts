import { adminCan, type AdminPerm } from "@shared/api";
import { useAppSelector } from "@/store/hooks";

/** Capability check for the signed-in admin (mirrors the API permission matrix). */
export function useAdminCan(perm: AdminPerm): boolean {
  const role = useAppSelector((s) => s.portalAuth.admin.user?.role);
  return adminCan(role, perm);
}
