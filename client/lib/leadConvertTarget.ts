import type { AdminLead, LeadConvertTarget } from "@shared/api";

/** Smart default Convert target from source / audience_tag / notes (decision 8c). */
export function smartLeadConvertTarget(lead: Pick<
  AdminLead,
  "source" | "notes" | "audience_tag"
>): LeadConvertTarget {
  const src = String(lead.source || "").toLowerCase();
  const notes = String(lead.notes || "").toLowerCase();
  const tag = String(lead.audience_tag || "").toLowerCase();

  if (
    tag === "contractor_lead" ||
    notes.includes("intent=contractor") ||
    src.includes("contractor")
  ) {
    return "contractor";
  }
  if (
    tag === "affiliate_lead" ||
    src === "partner_referral" ||
    notes.includes("intent=partner") ||
    notes.includes("company=") ||
    src.includes("affiliate") ||
    src.includes("partner")
  ) {
    return "affiliate";
  }
  return "client";
}

export function leadAlreadyConverted(
  lead: Pick<
    AdminLead,
    "client_id" | "converted_affiliate_id" | "converted_contractor_id"
  >,
): boolean {
  return Boolean(
    lead.client_id || lead.converted_affiliate_id || lead.converted_contractor_id,
  );
}
