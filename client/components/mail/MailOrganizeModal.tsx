import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MailRuleEngine } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { createMailFolder, createMailRule, deleteMailFolder, deleteMailRule, fetchMailFolders, fetchMailRules, renameMailFolder, toggleMailRule } from "@/store/slices/mailSlice";
import { BusyButton, ErrorNote, Modal, SegmentedTabs } from "@/components/portal/kit";

const PERSON_KINDS = ["any_crm", "client", "lead", "affiliate", "contractor", "contact"];

/** Folders and rules for one mailbox. Folders are real Outlook folders; rules run in Outlook or the CRM. */
export default function MailOrganizeModal({ mailboxId, canEdit, onClose }: { mailboxId: number; canEdit: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const folders = useAppSelector((s) => s.mail.folders[mailboxId]) || [];
  const { rules, rulesOutlookError, organizeBusy, organizeError } = useAppSelector((s) => s.mail);
  const [tab, setTab] = useState<"folders" | "rules">("folders");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [engine, setEngine] = useState<MailRuleEngine>("outlook");
  const [rule, setRule] = useState({ name: "", from: "", subject: "", person_kind: "", folder_id: "", mark_read: false });

  useEffect(() => {
    void dispatch(fetchMailFolders(mailboxId));
    void dispatch(fetchMailRules(mailboxId));
  }, [dispatch, mailboxId]);

  const addFolder = async () => {
    const r = await dispatch(createMailFolder({ mailbox_id: mailboxId, name: name.trim() }));
    if (createMailFolder.fulfilled.match(r)) setName("");
  };
  const addRule = async () => {
    const r = await dispatch(
      createMailRule({
        mailbox_id: mailboxId,
        engine,
        name: rule.name.trim(),
        from: rule.from.trim() || undefined,
        subject: rule.subject.trim() || undefined,
        person_kind: engine === "crm" && rule.person_kind ? rule.person_kind : undefined,
        folder_id: Number(rule.folder_id),
        mark_read: rule.mark_read,
      }),
    );
    if (createMailRule.fulfilled.match(r)) {
      setRule({ name: "", from: "", subject: "", person_kind: "", folder_id: "", mark_read: false });
      void dispatch(fetchMailRules(mailboxId));
    }
  };
  const hasCondition = Boolean(rule.from.trim() || rule.subject.trim() || (engine === "crm" && rule.person_kind));
  const folderName = (id: number | null) => folders.find((f) => f.id === id)?.name || t("mail.organize.unknownFolder");

  return (
    <Modal open titleKey="mail.organize.title" onClose={onClose}>
      <div className="pf-form gw-mail-org">
        <SegmentedTabs<"folders" | "rules">
          value={tab}
          onChange={setTab}
          ariaLabel={t("mail.organize.title")}
          options={[
            { value: "folders", labelKey: "mail.organize.folders", count: folders.length || null },
            { value: "rules", labelKey: "mail.organize.rules", count: rules.length || null },
          ]}
        />
        <ErrorNote error={organizeError} />
        {tab === "folders" ? (
          <>
            <p className="pf-hint">{t("mail.organize.foldersHint")}</p>
            {canEdit ? (
              <div className="gw-mail-org__add">
                <input value={name} maxLength={120} placeholder={t("mail.organize.folderName")} aria-label={t("mail.organize.folderName")} onChange={(e) => setName(e.target.value)} />
                <BusyButton tone="gold" icon={Plus} label={t("mail.organize.addFolder")} busy={organizeBusy} disabled={!name.trim()} onClick={() => void addFolder()} />
              </div>
            ) : null}
            {!folders.length ? <p className="pf-hint">{t("mail.organize.noFolders")}</p> : null}
            <ul className="gw-mail-org__list">
              {folders.map((f) => (
                <li key={f.id}>
                  {editing === f.id ? (
                    <div className="gw-mail-org__add">
                      <input value={editName} maxLength={120} aria-label={t("mail.organize.folderName")} onChange={(e) => setEditName(e.target.value)} />
                      <BusyButton
                        tone="gold"
                        label={t("pf.save")}
                        busy={organizeBusy}
                        disabled={!editName.trim()}
                        onClick={async () => {
                          const r = await dispatch(renameMailFolder({ id: f.id, mailbox_id: mailboxId, name: editName.trim() }));
                          if (renameMailFolder.fulfilled.match(r)) setEditing(null);
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      <span className="gw-mail-org__main">
                        <strong>{f.name}</strong>
                        <small>{t("mail.organize.threadCount", { count: f.thread_count })}</small>
                      </span>
                      {canEdit ? (
                        <span className="gw-mail-org__acts">
                          <button
                            type="button"
                            className="pf-icon-btn"
                            aria-label={t("mail.organize.rename", { name: f.name })}
                            onClick={() => {
                              setEditing(f.id);
                              setEditName(f.name);
                            }}
                          >
                            <Pencil size={14} />
                          </button>
                          <button type="button" className="pf-icon-btn" aria-label={t("mail.organize.delete", { name: f.name })} onClick={() => void dispatch(deleteMailFolder({ id: f.id, mailbox_id: mailboxId }))}>
                            <Trash2 size={14} />
                          </button>
                        </span>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {rulesOutlookError ? <p className="gw-qr-warn">{t(rulesOutlookError)}</p> : null}
            {canEdit && folders.length ? (
              <div className="pf-form">
                <label className="pf-field">
                  <span>{t("mail.organize.engine")}</span>
                  <select value={engine} onChange={(e) => setEngine(e.target.value as MailRuleEngine)}>
                    <option value="outlook">{t("mail.organize.engineOutlook")}</option>
                    <option value="crm">{t("mail.organize.engineCrm")}</option>
                  </select>
                </label>
                <p className="pf-hint">{t(engine === "outlook" ? "mail.organize.engineOutlookHint" : "mail.organize.engineCrmHint")}</p>
                <label className="pf-field">
                  <span>{t("mail.organize.ruleName")}</span>
                  <input value={rule.name} maxLength={160} onChange={(e) => setRule({ ...rule, name: e.target.value })} />
                </label>
                <label className="pf-field">
                  <span>{t("mail.organize.fromContains")}</span>
                  <input value={rule.from} maxLength={255} spellCheck={false} onChange={(e) => setRule({ ...rule, from: e.target.value })} />
                </label>
                <label className="pf-field">
                  <span>{t("mail.organize.subjectContains")}</span>
                  <input value={rule.subject} maxLength={255} onChange={(e) => setRule({ ...rule, subject: e.target.value })} />
                </label>
                {engine === "crm" ? (
                  <label className="pf-field">
                    <span>{t("mail.organize.personKind")}</span>
                    <select value={rule.person_kind} onChange={(e) => setRule({ ...rule, person_kind: e.target.value })}>
                      <option value="">{t("mail.organize.anyone")}</option>
                      {PERSON_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`mail.organize.person_${k}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="pf-field">
                  <span>{t("mail.organize.moveTo")}</span>
                  <select value={rule.folder_id} onChange={(e) => setRule({ ...rule, folder_id: e.target.value })}>
                    <option value="">{t("mail.organize.chooseFolder")}</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="gw-qr-card__toggle">
                  <input type="checkbox" checked={rule.mark_read} onChange={(e) => setRule({ ...rule, mark_read: e.target.checked })} />
                  <span>{t("mail.organize.markRead")}</span>
                </label>
                <div className="pf-actions">
                  <BusyButton tone="gold" icon={Plus} label={t("mail.organize.addRule")} busy={organizeBusy} disabled={!rule.name.trim() || !rule.folder_id || !hasCondition} onClick={() => void addRule()} />
                </div>
              </div>
            ) : null}
            {canEdit && !folders.length ? <p className="pf-hint">{t("mail.organize.needFolder")}</p> : null}
            {!rules.length ? <p className="pf-hint">{t("mail.organize.noRules")}</p> : null}
            <ul className="gw-mail-org__list">
              {rules.map((r) => (
                <li key={`${r.engine}-${r.id}`}>
                  <span className="gw-mail-org__main">
                    <strong>{r.name}</strong>
                    <small>
                      {t(r.engine === "outlook" ? "mail.organize.engineOutlook" : "mail.organize.engineCrm")}
                      {r.from ? ` · ${t("mail.organize.fromContains")}: ${r.from}` : ""}
                      {r.subject ? ` · ${t("mail.organize.subjectContains")}: ${r.subject}` : ""}
                      {r.person_kind ? ` · ${t(`mail.organize.person_${r.person_kind}`)}` : ""}
                      {` · ${folderName(r.folder_id)}`}
                    </small>
                  </span>
                  {canEdit ? (
                    <span className="gw-mail-org__acts">
                      <input
                        type="checkbox"
                        checked={r.active}
                        aria-label={t("mail.organize.ruleOn", { name: r.name })}
                        onChange={async (e) => {
                          await dispatch(toggleMailRule({ engine: r.engine, id: r.id, mailbox_id: mailboxId, active: e.target.checked }));
                          void dispatch(fetchMailRules(mailboxId));
                        }}
                      />
                      <button
                        type="button"
                        className="pf-icon-btn"
                        aria-label={t("mail.organize.delete", { name: r.name })}
                        onClick={async () => {
                          await dispatch(deleteMailRule({ engine: r.engine, id: r.id, mailbox_id: mailboxId }));
                          void dispatch(fetchMailRules(mailboxId));
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
