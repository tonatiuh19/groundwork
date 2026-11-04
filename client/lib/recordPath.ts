/**
 * Admin page for a CRM person. Leads and contacts have no detail page, so they
 * open their list filtered by phone or email.
 */
export function personRecordPath(kind: string, id: number, search?: string | null): string {
  switch (kind) {
    case "client":
      return `/admin/clients/${id}`;
    case "affiliate":
      return `/admin/affiliates/${id}`;
    case "contractor":
      return `/admin/contractors/${id}`;
    case "contact":
      return `/admin/contacts?q=${encodeURIComponent(search || "")}`;
    case "lead":
      return `/admin/leads?q=${encodeURIComponent(search || "")}`;
    default:
      return "/admin/staff";
  }
}
