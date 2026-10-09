import type { ConversationTemplate } from "@shared/api";

export const CONVERSATION_TEMPLATE_VARS = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "full_name", label: "Full name" },
  { key: "phone", label: "Phone" },
  { key: "client_status", label: "Status" },
] as const;

export const CONVERSATION_COMPOSER_QUICK_VARS = [
  "first_name",
  "phone",
] as const satisfies ReadonlyArray<
  (typeof CONVERSATION_TEMPLATE_VARS)[number]["key"]
>;

export type ConversationVarKey =
  (typeof CONVERSATION_TEMPLATE_VARS)[number]["key"];

export type ConversationMergeContext = Partial<
  Record<ConversationVarKey, string | null | undefined>
> & {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  client_status?: string | null;
  preferred_language?: "en" | "es" | null;
};

export function buildConversationMergeVars(
  ctx: ConversationMergeContext,
): Record<string, string> {
  const first = String(ctx.first_name || "").trim();
  const last = String(ctx.last_name || "").trim();
  const full = `${first} ${last}`.trim();
  return {
    first_name: first || "there",
    last_name: last,
    full_name: full || first || "there",
    phone: String(ctx.phone || "").trim(),
    client_status: String(ctx.client_status || "").trim(),
  };
}

export function applyConversationTemplateVars(
  text: string,
  vars: Record<string, string>,
): string {
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    vars[key] != null && vars[key] !== "" ? vars[key] : `{{${key}}}`,
  );
}

export function templateBodyForLang(
  tpl: ConversationTemplate,
  lang: "en" | "es",
): string {
  if (lang === "es" && tpl.body_es?.trim()) return tpl.body_es;
  return tpl.body_en || tpl.body_es || "";
}

export function applyConversationTemplate(
  template: ConversationTemplate,
  vars: Record<string, string>,
  lang: "en" | "es" = "en",
): { body: string } {
  return {
    body: applyConversationTemplateVars(templateBodyForLang(template, lang), vars),
  };
}

export function getOpenVariableToken(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const m = before.match(/\{\{([a-zA-Z0-9_]*)$/);
  if (!m) return null;
  return { start: cursor - m[0].length, query: m[1] || "" };
}
