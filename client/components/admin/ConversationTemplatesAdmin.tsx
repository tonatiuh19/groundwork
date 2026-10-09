import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/portal/Modal";
import { BusyButton, ErrorNote } from "@/components/portal/kit";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createConversationTemplate,
  deleteConversationTemplate,
  fetchConversationTemplates,
  updateConversationTemplate,
} from "@/store/slices/conversationsSlice";

export function ConversationTemplatesAdmin({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const templates = useAppSelector((s) => s.conversations.templates);
  const loading = useAppSelector((s) => s.conversations.templatesLoading);
  const [title, setTitle] = useState("");
  const [bodyEn, setBodyEn] = useState("");
  const [bodyEs, setBodyEs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) void dispatch(fetchConversationTemplates({ all: true }));
  }, [dispatch, open]);

  return (
    <Modal open={open} titleKey="conversations.templatesAdminTitle" onClose={onClose}>
      <div className="space-y-4 max-w-full">
        <p className="text-sm text-muted-foreground">
          {t("conversations.templatesAdminLead")}
        </p>
        {loading && (
          <p className="text-sm text-muted-foreground">{t("conversations.loading")}</p>
        )}
        <ul className="space-y-2 max-h-64 overflow-y-auto">
          {templates.map((tpl) => (
            <li
              key={tpl.id}
              className="rounded-lg border border-border p-3 space-y-1"
            >
              <div className="flex items-start justify-between gap-2">
                <strong className="text-sm">{tpl.title}</strong>
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    className="pf-btn pf-btn--sm"
                    onClick={() => {
                      void dispatch(
                        updateConversationTemplate({
                          id: tpl.id,
                          is_active: !tpl.is_active,
                        }),
                      );
                    }}
                  >
                    {tpl.is_active
                      ? t("conversations.templateDeactivate")
                      : t("conversations.templateActivate")}
                  </button>
                  <button
                    type="button"
                    className="pf-btn pf-btn--sm"
                    onClick={() => {
                      void dispatch(deleteConversationTemplate({ id: tpl.id }));
                    }}
                  >
                    {t("conversations.templateDelete")}
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {tpl.body_en}
              </p>
            </li>
          ))}
        </ul>

        <div className="space-y-2 border-t border-border pt-3">
          <h3 className="text-sm font-semibold">
            {t("conversations.templateNew")}
          </h3>
          <input
            className="pf-input w-full"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("conversations.templateTitle")}
          />
          <textarea
            className="pf-input w-full min-h-[4rem]"
            value={bodyEn}
            onChange={(e) => setBodyEn(e.target.value)}
            placeholder={t("conversations.templateBodyEn")}
          />
          <textarea
            className="pf-input w-full min-h-[3rem]"
            value={bodyEs}
            onChange={(e) => setBodyEs(e.target.value)}
            placeholder={t("conversations.templateBodyEs")}
          />
          {error && <ErrorNote error={error} />}
          <BusyButton
            type="button"
            className="pf-btn pf-btn--primary"
            busy={busy}
            label={t("conversations.templateCreate")}
            onClick={async () => {
              setError(null);
              setBusy(true);
              try {
                await dispatch(
                  createConversationTemplate({
                    title: title.trim(),
                    body_en: bodyEn.trim(),
                    body_es: bodyEs.trim() || null,
                  }),
                ).unwrap();
                setTitle("");
                setBodyEn("");
                setBodyEs("");
              } catch (e) {
                setError(typeof e === "string" ? e : "errors.server");
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
