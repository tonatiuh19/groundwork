/** Demoting an active account — needs an explicit confirm in admin people grids. */
export function isDemotingAccountStatus(from: string, to: string): boolean {
  return from === "active" && (to === "inactive" || to === "suspended");
}
