import type { ConstructionAgreementFieldDef } from "@shared/api";

/** Live preview of the server's fill: required blanks show as [______], optional blanks as N/A. */
export function renderConstructionAgreementPreview(body: string, fields: Record<string, string>, defs: ConstructionAgreementFieldDef[]): string {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  return body.replace(/\{\{(\w+)\}\}/g, (m, k: string) => {
    const v = String(fields[k] ?? "").trim();
    if (v) return v.replace(/\n+/g, " ");
    const def = byKey.get(k);
    if (!def) return m;
    return def.required ? "[______]" : "N/A";
  });
}

/** Required fields the template uses that are still blank. */
export function missingAgreementFields(body: string, fields: Record<string, string>, defs: ConstructionAgreementFieldDef[]): string[] {
  const used = new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
  return defs.filter((d) => d.required && used.has(d.key) && !String(fields[d.key] ?? "").trim()).map((d) => d.key);
}
