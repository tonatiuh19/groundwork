import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Lock,
  MessageSquare,
  FileText,
  Phone,
  Plus,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  AdminClient,
  ConversationContactKind,
  ConversationHubContact,
} from "@shared/api";
import {
  ConversationMessageComposer,
  type ConversationMediaAttachment,
} from "@/components/admin/ConversationMessageComposer";
import {
  ConversationComposeTargetPicker,
  type ConversationComposeTarget,
} from "@/components/admin/ConversationComposeTargetPicker";
import { ConversationComposeAlsoSend } from "@/components/admin/ConversationComposeAlsoSend";
import { ConversationLinkClientPicker } from "@/components/admin/ConversationLinkClientPicker";
import type { AlsoRecipient } from "@/lib/conversationAlsoSend";
import { ConversationMessageStatus } from "@/components/admin/ConversationMessageStatus";
import { ConversationMediaLightbox } from "@/components/admin/ConversationMediaLightbox";
import { ConversationVoiceSettingsModal } from "@/components/admin/ConversationVoiceSettingsModal";
import { VoiceAudioDevicePicker } from "@/components/admin/VoiceAudioDevicePicker";
import ConversationsHubSkeleton, {
  ConversationsContactListSkeleton,
  ConversationsTimelineSkeleton,
} from "@/components/admin/ConversationsHubSkeleton";
import { Modal } from "@/components/portal/Modal";
import {
  ErrorNote,
  HeaderAction,
  PageHeader,
} from "@/components/portal/kit";
import { translateApiError } from "@/lib/api";
import {
  type ConversationMergeContext,
} from "@/lib/conversationTemplateVars";
import { formatConversationListTime } from "@/lib/conversationListTime";
import { conversationMediaDisplayUrl } from "@/lib/conversationMedia";
import { buildStaticConversationSuggestions } from "@/lib/conversationSuggestedReplies";
import { parseComposePhoneInput } from "@/lib/parseComposePhone";
import { useDebounce } from "@/hooks/useDebounce";
import { useVoiceDeviceOptional } from "@/contexts/VoiceDeviceContext";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  assignConversationToMe,
  createProspectFromUnknown,
  searchConversationLeads,
  retryCallTranscript,
  dismissUnknownConversation,
  fetchConversationInbox,
  fetchConversationsAccess,
  fetchConversationsNavBadge,
  fetchConversationTemplates,
  fetchConversationTimeline,
  linkUnknownConversation,
  selectConversationContact,
  sendConversationMessage,
  setConversationContactStatus,
  setConversationsSearch,
  setConversationsSendError,
  setConversationsView,
  startConversationOutbound,
  uploadConversationMedia,
  type ConversationsView,
} from "@/store/slices/conversationsSlice";
import {
  endOutboundCall,
  setDialpadOpen,
  setVoiceAvailableLocal,
  setVoiceSettingsOpen,
  startOutboundCall,
} from "@/store/slices/voiceSlice";
import { cn } from "@/lib/cn";
import { logger } from "@/utils/logger";

const VIEWS: ConversationsView[] = [
  "all",
  "mine",
  "unassigned",
  "unread",
  "unknown",
  "open",
  "closed",
];
const ONBOARD_KEY = "gw.conversations.onboarding.v1";

function contactKey(c: { kind: string; contact_id: number }) {
  return `${c.kind}:${c.contact_id}`;
}

export default function AdminConversations() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAppSelector((s) => s.portalAuth.admin.user);
  const voiceDevice = useVoiceDeviceOptional();
  const {
    accessEnabled,
    accessLoading,
    accessNumbers,
    inbox,
    leadMatches,
    inboxLoading,
    inboxRefreshing,
    inboxError,
    inboxPagination,
    view,
    search,
    activeKind,
    activeId,
    timeline,
    timelineLoading,
    sending,
    sendError,
    templates,
    realtimeSeq,
  } = useAppSelector((s) => s.conversations);
  const dialpadOpen = useAppSelector((s) => s.voice.dialpadOpen);
  const settingsOpen = useAppSelector((s) => s.voice.settingsOpen);
  const deviceStatus = useAppSelector((s) => s.voice.deviceStatus);
  const isAvailable = useAppSelector((s) => s.voice.isAvailable);
  const [dialing, setDialing] = useState(false);
  /** Client context when opening dialpad from a thread Call (pre-call audio first). */
  const [pendingDialClient, setPendingDialClient] = useState<{
    id?: number;
    name?: string;
  } | null>(null);

  const toggleVoiceAvailable = () => {
    // GlobalVoiceManager registers/unregisters + syncs API when isAvailable changes.
    const next = !isAvailable;
    try {
      localStorage.setItem("gw.voice.available", String(next));
    } catch {
      /* ignore */
    }
    dispatch(setVoiceAvailableLocal(next));
  };

  // Use shared accountStatus.active/inactive so EN/ES match the rest of the portal.
  const availabilityLabel = !isAvailable
    ? t("accountStatus.inactive")
    : deviceStatus === "ready"
      ? t("accountStatus.active")
      : deviceStatus === "connecting"
        ? t("conversations.voiceConnecting")
        : deviceStatus === "error"
          ? t("conversations.voiceError")
          : t("accountStatus.active");

  const availabilityTitle = !isAvailable
    ? t("conversations.voiceGoAvailable")
    : deviceStatus === "ready"
      ? t("conversations.voiceGoOffline")
      : deviceStatus === "connecting"
        ? t("conversations.voiceConnecting")
        : deviceStatus === "error"
          ? t("conversations.voiceError")
          : t("conversations.voiceGoOffline");

  const [composer, setComposer] = useState("");
  const [channel, setChannel] = useState<"sms" | "internal">("sms");
  const [showNew, setShowNew] = useState(false);
  const [composeTarget, setComposeTarget] =
    useState<ConversationComposeTarget | null>(null);
  const [newBody, setNewBody] = useState("");
  const [newChannel, setNewChannel] = useState<"sms" | "internal">("sms");
  const [alsoRecipients, setAlsoRecipients] = useState<AlsoRecipient[]>([]);
  const [threadAttachment, setThreadAttachment] =
    useState<ConversationMediaAttachment | null>(null);
  const [composeAttachment, setComposeAttachment] =
    useState<ConversationMediaAttachment | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [fromNumberId, setFromNumberId] = useState<number | null>(null);
  /** Thread replies: null = automatic (the conversation's own line, chosen server-side). */
  const [threadFromId, setThreadFromId] = useState<number | null>(null);
  useEffect(() => setThreadFromId(null), [activeKind, activeId]);
  const [mobileThread, setMobileThread] = useState(false);
  const [searchDraft, setSearchDraft] = useState(search);
  const debouncedSearch = useDebounce(searchDraft, 350);
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<{
    url: string;
    contentType?: string | null;
  } | null>(null);
  const [dialDigits, setDialDigits] = useState("");
  const [linkClient, setLinkClient] = useState<AdminClient | null>(null);
  const [unknownBusy, setUnknownBusy] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const dialInputRef = useRef<HTMLInputElement>(null);
  const lastRealtimeSeqRef = useRef(0);
  const activeThreadRef = useRef({ kind: activeKind, id: activeId });
  activeThreadRef.current = { kind: activeKind, id: activeId };

  const enabled = accessEnabled ?? user?.conversations_enabled ?? false;
  const templateLang = i18n.language?.startsWith("es") ? "es" : "en";
  const timeLang = templateLang;

  useEffect(() => {
    dispatch(setConversationsSearch(debouncedSearch));
  }, [debouncedSearch, dispatch]);

  useEffect(() => {
    try {
      if (!localStorage.getItem(ONBOARD_KEY)) setShowOnboarding(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (accessNumbers[0] && fromNumberId == null) {
      setFromNumberId(Number(accessNumbers[0].id));
    }
  }, [accessNumbers, fromNumberId]);

  const activeContact = useMemo(
    () =>
      inbox.find((c) => c.kind === activeKind && c.contact_id === activeId) ||
      null,
    [inbox, activeKind, activeId],
  );

  const mergeContext = useMemo((): ConversationMergeContext => {
    const contact = timeline?.contact || {};
    const first =
      (contact.first_name as string | undefined) ||
      String(activeContact?.display_name || "").split(/\s+/)[0] ||
      "";
    const last =
      (contact.last_name as string | undefined) ||
      String(activeContact?.display_name || "")
        .split(/\s+/)
        .slice(1)
        .join(" ") ||
      "";
    return {
      first_name: first,
      last_name: last,
      phone: String(contact.phone || activeContact?.phone || ""),
      client_status: String(
        (contact.status as string | undefined) ||
          activeContact?.client_status ||
          "",
      ),
      // Templates follow the contact's language (client / CRM contact), else the UI language.
      preferred_language:
        contact.preferred_language === "es" || contact.preferred_language === "en"
          ? (contact.preferred_language as "en" | "es")
          : (templateLang as "en" | "es"),
    };
  }, [timeline, activeContact, templateLang]);

  const suggested = useMemo(
    () =>
      buildStaticConversationSuggestions({
        kind: (activeKind || "client") as "client" | "unknown" | "contact",
        mergeContext,
        clientStatus: activeContact?.client_status,
        preferredLanguage: templateLang,
      }),
    [activeKind, activeContact?.client_status, mergeContext, templateLang],
  );

  const refreshInbox = (soft = false, append = false) => {
    const page = append
      ? (inboxPagination?.page || 1) + 1
      : 1;
    void dispatch(
      fetchConversationInbox({
        view,
        soft,
        append,
        page,
        q: search.trim() || undefined,
      }),
    );
  };

  useEffect(() => {
    void dispatch(fetchConversationsAccess());
  }, [dispatch]);

  useEffect(() => {
    if (!enabled) return;
    // Ignore pulses that happened while this page was unmounted.
    lastRealtimeSeqRef.current = realtimeSeq;
    void dispatch(fetchConversationTemplates());
    void dispatch(fetchConversationsNavBadge());
    refreshInbox(false);
    // Ably live updates via AdminRealtimeBridge → realtimeSeq (no interval poll).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, enabled, view, search]);

  // Leads are not thread contacts yet — search them alongside the inbox.
  useEffect(() => {
    if (!enabled) return;
    void dispatch(searchConversationLeads(search));
  }, [dispatch, enabled, search]);

  useEffect(() => {
    if (!enabled) return;
    if (realtimeSeq === lastRealtimeSeqRef.current) return;
    lastRealtimeSeqRef.current = realtimeSeq;
    refreshInbox(true);
    const { kind, id } = activeThreadRef.current;
    if (kind && id) {
      void dispatch(fetchConversationTimeline({ kind, id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, realtimeSeq, dispatch]);

  useEffect(() => {
    const client = searchParams.get("client");
    const contact = searchParams.get("contact");
    const unknown = searchParams.get("unknown");
    const dial = searchParams.get("dial");
    const compose = searchParams.get("compose");
    const phoneParam = searchParams.get("phone");
    const nameParam = searchParams.get("name") || "";
    if (client) {
      dispatch(selectConversationContact({ kind: "client", id: Number(client) }));
      setMobileThread(true);
    } else if (contact) {
      dispatch(
        selectConversationContact({ kind: "contact", id: Number(contact) }),
      );
      setMobileThread(true);
    } else if (unknown) {
      dispatch(
        selectConversationContact({ kind: "unknown", id: Number(unknown) }),
      );
      setMobileThread(true);
    }

    let stripCompose = false;
    let stripDialPhone = false;
    if (compose === "1" && phoneParam) {
      const parsed = parseComposePhoneInput(phoneParam);
      if (parsed) {
        setComposeTarget({
          kind: "phone",
          phone: parsed.phone,
          label: nameParam.trim() || parsed.label,
        });
        setShowNew(true);
        stripCompose = true;
      }
    }
    if (dial === "1") {
      dispatch(setDialpadOpen(true));
      if (phoneParam) {
        const parsed = parseComposePhoneInput(phoneParam);
        setDialDigits(parsed?.phone || phoneParam);
        stripDialPhone = true;
      }
    }

    // Consume one-shot deep-link params so remount / Strict Mode does not re-open UI.
    if (stripCompose || stripDialPhone || (dial === "1" && phoneParam)) {
      const next = new URLSearchParams(searchParams);
      if (stripCompose) {
        next.delete("compose");
        next.delete("name");
        if (!dial || stripDialPhone) next.delete("phone");
      }
      if (stripDialPhone) {
        next.delete("dial");
        next.delete("phone");
      }
      if (next.toString() !== searchParams.toString()) {
        setSearchParams(next, { replace: true });
      }
    }
  }, [dispatch, searchParams, setSearchParams]);

  useEffect(() => {
    if (searchParams.get("dial") !== "1") return;
    // Phone-only dial links are handled above; wait for hub row / timeline for client|contact.
    if (searchParams.get("phone")) return;
    const client = searchParams.get("client");
    const contact = searchParams.get("contact");
    const phone =
      (timeline?.contact?.phone as string | undefined) ||
      inbox.find(
        (c) =>
          (client && c.kind === "client" && c.contact_id === Number(client)) ||
          (contact &&
            c.kind === "contact" &&
            c.contact_id === Number(contact)),
      )?.phone ||
      "";
    if (!phone) return;
    setDialDigits(String(phone));
    const next = new URLSearchParams(searchParams);
    next.delete("dial");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, timeline?.contact, inbox]);

  const pickMedia = async (
    file: File,
    setter: (a: ConversationMediaAttachment | null) => void,
  ) => {
    setUploadingMedia(true);
    dispatch(setConversationsSendError(null));
    const preview = URL.createObjectURL(file);
    try {
      const uploaded = await dispatch(uploadConversationMedia({ file })).unwrap();
      setter({
        url: uploaded.url,
        content_type: uploaded.content_type,
        filename: file.name,
        preview_url: preview,
      });
    } catch {
      URL.revokeObjectURL(preview);
      dispatch(setConversationsSendError("conversations.mmsUploadFailed"));
    } finally {
      setUploadingMedia(false);
    }
  };

  useEffect(() => {
    if (!activeKind || !activeId || !enabled) return;
    void dispatch(
      fetchConversationTimeline({ kind: activeKind, id: activeId }),
    );
  }, [activeKind, activeId, dispatch, enabled]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [timeline?.messages?.length]);

  const openThread = (c: ConversationHubContact) => {
    dispatch(
      selectConversationContact({ kind: c.kind, id: c.contact_id }),
    );
    setMobileThread(true);
    const key =
      c.kind === "client"
        ? "client"
        : c.kind === "contact"
          ? "contact"
          : "unknown";
    setSearchParams({ [key]: String(c.contact_id) }, { replace: true });
  };

  const sendActive = async () => {
    if (!activeKind || !activeId) return;
    const body = composer.trim();
    if (!body && !threadAttachment?.url && channel === "sms") return;
    if (channel === "internal" && !body) return;
    dispatch(setConversationsSendError(null));
    const payload: Parameters<typeof sendConversationMessage>[0] = {
      channel,
      body: body || "",
      is_internal_note: channel === "internal",
      ofg_number_id: threadFromId || undefined,
      media_url:
        channel === "sms" ? threadAttachment?.url || undefined : undefined,
      media_content_type:
        channel === "sms"
          ? threadAttachment?.content_type || undefined
          : undefined,
    };
    if (activeKind === "client") payload.client_id = activeId;
    else if (activeKind === "unknown") payload.unknown_contact_id = activeId;
    else payload.contact_id = activeId;
    try {
      await dispatch(sendConversationMessage(payload)).unwrap();
      setComposer("");
      if (threadAttachment?.preview_url) {
        URL.revokeObjectURL(threadAttachment.preview_url);
      }
      setThreadAttachment(null);
      void dispatch(
        fetchConversationTimeline({ kind: activeKind, id: activeId }),
      );
      refreshInbox(true);
    } catch {
      /* sendError in slice */
    }
  };

  const sendNew = async () => {
    if (!composeTarget || (!newBody.trim() && !composeAttachment?.url)) return;
    dispatch(setConversationsSendError(null));
    const media = {
      media_url: composeAttachment?.url,
      media_content_type: composeAttachment?.content_type,
    };
    try {
      if (composeTarget.kind === "phone") {
        const result = await dispatch(
          startConversationOutbound({
            phone: composeTarget.phone,
            body: newBody.trim(),
            ofg_number_id: fromNumberId || undefined,
            ...media,
          }),
        ).unwrap();
        const kind = result.kind;
        const id =
          result.client_id ||
          result.contact_id ||
          result.unknown_contact_id;
        if (kind && id) {
          dispatch(selectConversationContact({ kind, id }));
          setMobileThread(true);
        }
      } else if (composeTarget.kind === "client") {
        await dispatch(
          sendConversationMessage({
            client_id: composeTarget.client.id,
            body: newBody.trim(),
            channel: newChannel,
            ofg_number_id: fromNumberId || undefined,
            ...media,
          }),
        ).unwrap();
        dispatch(
          selectConversationContact({
            kind: "client",
            id: composeTarget.client.id,
          }),
        );
        setMobileThread(true);
      } else {
        await dispatch(
          sendConversationMessage({
            contact_id: composeTarget.contact.id,
            body: newBody.trim(),
            channel: "sms",
            ofg_number_id: fromNumberId || undefined,
            ...media,
          }),
        ).unwrap();
        dispatch(
          selectConversationContact({
            kind: "contact",
            id: composeTarget.contact.id,
          }),
        );
        setMobileThread(true);
      }
      let alsoOk = 0;
      let alsoFail = 0;
      for (const r of alsoRecipients) {
        try {
          await dispatch(
            startConversationOutbound({
              phone: r.phone,
              body: newBody.trim() || t("conversations.mmsAttached"),
              ofg_number_id: fromNumberId || undefined,
              ...media,
            }),
          ).unwrap();
          alsoOk += 1;
        } catch {
          alsoFail += 1;
        }
      }
      setShowNew(false);
      setComposeTarget(null);
      setNewBody("");
      setAlsoRecipients([]);
      if (composeAttachment?.preview_url) {
        URL.revokeObjectURL(composeAttachment.preview_url);
      }
      setComposeAttachment(null);
      refreshInbox(true);
      if (alsoFail > 0) {
        dispatch(
          setConversationsSendError(
            t("conversations.alsoSendPartial", {
              ok: alsoOk,
              fail: alsoFail,
            }),
          ),
        );
      }
    } catch {
      /* slice error — keep modal open when primary failed */
    }
  };

  /** Opens dialpad so staff pick mic/speaker before Call (Optimum pre-call flow). */
  const openDialpadForCall = (
    phone: string,
    clientId?: number,
    name?: string,
  ) => {
    setDialDigits(phone || "");
    setPendingDialClient(
      clientId || name ? { id: clientId, name } : null,
    );
    dispatch(setConversationsSendError(null));
    dispatch(setDialpadOpen(true));
  };

  /** Places an outbound Twilio call. Returns true when connect succeeds. */
  const placeCall = async (
    phone: string,
    clientId?: number,
    name?: string,
  ): Promise<boolean> => {
    if (!isAvailable) {
      dispatch(setConversationsSendError("conversations.dialpadNeedAvailable"));
      return false;
    }
    const parsed = parseComposePhoneInput(phone);
    if (!parsed) {
      dispatch(setConversationsSendError("conversations.invalidDialNumber"));
      return false;
    }
    if (!voiceDevice?.connectOutbound) {
      dispatch(setConversationsSendError("conversations.voiceNotReady"));
      return false;
    }
    dispatch(setConversationsSendError(null));
    dispatch(
      startOutboundCall({
        phone: parsed.phone,
        clientId: clientId ?? null,
        clientName: name ?? null,
      }),
    );
    setDialing(true);
    try {
      const call = await voiceDevice.connectOutbound({ To: parsed.phone });
      if (!call) {
        dispatch(endOutboundCall());
        dispatch(setConversationsSendError("conversations.voiceNotReady"));
        return false;
      }
      // Mute / duration / log handled by VoiceCallPanel once Call is registered.
      return true;
    } catch (e) {
      logger.error("conversations", "dial failed", e);
      dispatch(endOutboundCall());
      dispatch(setConversationsSendError("conversations.dialFailed"));
      return false;
    } finally {
      setDialing(false);
    }
  };

  if (accessLoading && accessEnabled == null) {
    return (
      <div className="portal-page">
        <PageHeader titleKey="portalNav.conversations" leadKey="conversations.lead" />
        <ConversationsHubSkeleton />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="portal-page">
        <PageHeader titleKey="portalNav.conversations" leadKey="conversations.lead" />
        <div className="gw-lock-card">
          <Lock className="gw-lock-card__icon" aria-hidden />
          <h2>{t("conversations.lockedTitle")}</h2>
          <p>{t("conversations.lockedBody")}</p>
        </div>
      </div>
    );
  }

  const canLoadMore =
    inboxPagination &&
    inboxPagination.page < inboxPagination.totalPages;

  return (
    <div className="portal-page gw-conv-page">
      <PageHeader
        titleKey="portalNav.conversations"
        leadKey="conversations.lead"
        actions={
          <>
            <button
              type="button"
              className={cn(
                "gw-voice-avail",
                isAvailable && deviceStatus === "ready" && "is-available",
                isAvailable && deviceStatus === "connecting" && "is-connecting",
                isAvailable && deviceStatus === "error" && "is-error",
                !isAvailable && "is-offline",
              )}
              onClick={toggleVoiceAvailable}
              title={availabilityTitle}
              aria-pressed={isAvailable}
              aria-label={availabilityTitle}
            >
              <span className="gw-voice-avail__dot" aria-hidden />
              <span className="gw-voice-avail__label">{availabilityLabel}</span>
            </button>
            <HeaderAction
              labelKey="conversations.dialpad"
              icon={Phone}
              onClick={() => dispatch(setDialpadOpen(true))}
            />
            <HeaderAction
              labelKey="conversations.voiceSettings"
              icon={Settings2}
              onClick={() => dispatch(setVoiceSettingsOpen(true))}
            />
            <HeaderAction
              labelKey="conversations.templates"
              icon={FileText}
              onClick={() => navigate("/admin/templates")}
            />
            <HeaderAction
              labelKey="conversations.newMessage"
              icon={Plus}
              onClick={() => setShowNew(true)}
            />
          </>
        }
      />

      {showOnboarding && (
        <div className="gw-conv-onboard" role="status">
          <div className="min-w-0 flex-1">
            <strong>{t("conversations.onboardingTitle")}</strong>
            <p className="text-sm text-muted-foreground">
              {t("conversations.onboardingBody")}
            </p>
          </div>
          <button
            type="button"
            className="pf-btn pf-btn--sm"
            onClick={() => {
              try {
                localStorage.setItem(ONBOARD_KEY, "1");
              } catch {
                /* ignore */
              }
              setShowOnboarding(false);
            }}
          >
            {t("conversations.onboardingDismiss")}
          </button>
        </div>
      )}

      {inboxError ? <ErrorNote error={inboxError} /> : null}
      {sendError ? <ErrorNote error={sendError} /> : null}

      <div
        className={
          inboxRefreshing
            ? "gw-conv-shell is-refreshing"
            : "gw-conv-shell"
        }
      >
        <aside
          className={
            mobileThread ? "gw-conv-list is-hidden-mobile" : "gw-conv-list"
          }
        >
          <div className="gw-conv-list__tools">
            <label className="gw-conv-search">
              <Search className="w-4 h-4" aria-hidden />
              <input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder={t("conversations.searchPlaceholder")}
              />
              {searchDraft && (
                <button
                  type="button"
                  className="pf-icon-btn"
                  aria-label={t("conversations.clearSearch")}
                  onClick={() => setSearchDraft("")}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </label>
            <div className="gw-conv-views" role="tablist">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  className={
                    view === v ? "gw-conv-view is-active" : "gw-conv-view"
                  }
                  onClick={() => dispatch(setConversationsView(v))}
                >
                  {t(`conversations.views.${v}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="gw-conv-rows">
            {inboxLoading && !inbox.length ? (
              <ConversationsContactListSkeleton />
            ) : inbox.length === 0 ? (
              <p className="gw-conv-empty">{t("conversations.empty")}</p>
            ) : (
              inbox.map((c) => (
                <button
                  key={contactKey(c)}
                  type="button"
                  className={
                    activeKind === c.kind && activeId === c.contact_id
                      ? "gw-conv-row is-active"
                      : "gw-conv-row"
                  }
                  onClick={() => openThread(c)}
                >
                  <div className="gw-conv-row__top">
                    <strong>{c.display_name}</strong>
                    <time
                      title={c.last_message_at || undefined}
                      dateTime={c.last_message_at || undefined}
                    >
                      {formatConversationListTime(c.last_message_at, {
                        lang: timeLang,
                      })}
                    </time>
                  </div>
                  <div className="gw-conv-row__meta">
                    {c.match ? (
                      <span className={`gw-conv-kind gw-conv-match gw-conv-match--${c.match.role}`}>
                        {t(`conversations.match.${c.match.role}`)}
                      </span>
                    ) : (
                      <span className={`gw-conv-kind gw-conv-kind--${c.kind}`}>
                        {t(`conversations.kind.${c.kind}`)}
                      </span>
                    )}
                    {c.unread_count > 0 && (
                      <span className="gw-conv-unread">{c.unread_count}</span>
                    )}
                  </div>
                  <p className="gw-conv-row__preview">
                    {c.last_message_preview || t("conversations.noPreview")}
                  </p>
                </button>
              ))
            )}
            {search.trim().length >= 2 && leadMatches.length > 0 ? (
              <div className="gw-conv-lead-matches">
                <p className="gw-conv-lead-matches__title">{t("conversations.leadMatches")}</p>
                {leadMatches.map((l) => (
                  <button
                    key={`lead-${l.lead_id}`}
                    type="button"
                    className="gw-conv-row"
                    onClick={() => {
                      if (l.unknown_contact_id) {
                        dispatch(selectConversationContact({ kind: "unknown", id: l.unknown_contact_id }));
                        setSearchParams({ unknown: String(l.unknown_contact_id) }, { replace: true });
                        setMobileThread(true);
                      } else if (l.client_id) {
                        dispatch(selectConversationContact({ kind: "client", id: l.client_id }));
                        setSearchParams({ client: String(l.client_id) }, { replace: true });
                        setMobileThread(true);
                      } else {
                        setSearchParams({ compose: "1", phone: l.phone, name: l.full_name }, { replace: true });
                      }
                    }}
                  >
                    <div className="gw-conv-row__top">
                      <strong>{l.full_name}</strong>
                    </div>
                    <div className="gw-conv-row__meta">
                      <span className="gw-conv-kind gw-conv-kind--lead">{t("conversations.kind.lead")}</span>
                    </div>
                    <p className="gw-conv-row__preview">
                      {[l.phone, l.email].filter(Boolean).join(" · ")}
                    </p>
                  </button>
                ))}
              </div>
            ) : null}
            {canLoadMore && (
              <button
                type="button"
                className="pf-btn w-full"
                onClick={() => refreshInbox(true, true)}
              >
                {t("conversations.loadMore")}
              </button>
            )}
          </div>
        </aside>

        <section
          className={
            mobileThread
              ? "gw-conv-thread is-open-mobile"
              : "gw-conv-thread"
          }
        >
          {!activeKind || !activeId ? (
            <div className="gw-conv-thread-empty">
              <MessageSquare className="w-8 h-8 text-muted-foreground" />
              <p>{t("conversations.selectPrompt")}</p>
            </div>
          ) : timelineLoading && !timeline ? (
            <ConversationsTimelineSkeleton />
          ) : (
            <>
              <header className="gw-conv-thread-head">
                <button
                  type="button"
                  className="gw-conv-back"
                  onClick={() => {
                    setMobileThread(false);
                    dispatch(selectConversationContact(null));
                    setSearchParams({}, { replace: true });
                  }}
                >
                  <ArrowLeft className="w-4 h-4" />
                  {t("conversations.backToList")}
                </button>
                <div className="gw-conv-thread-head__copy min-w-0">
                  <h2 className="truncate">
                    {activeContact?.display_name || t("conversations.thread")}
                    {activeContact?.match ? (
                      <span className={`gw-conv-kind gw-conv-match gw-conv-match--${activeContact.match.role}`}>
                        {t(`conversations.match.${activeContact.match.role}`)}
                      </span>
                    ) : null}
                  </h2>
                  <p className="text-xs text-muted-foreground truncate">
                    {activeContact?.phone || activeContact?.email || ""}
                    {activeContact?.match ? (
                      <>
                        {" · "}
                        <Link className="text-link" to={matchPath(activeContact.match.role, activeContact.match.id, activeContact.phone)}>
                          {t("conversations.openRecord", { role: t(`conversations.match.${activeContact.match.role}`) })}
                        </Link>
                        {activeContact.match.others.length
                          ? ` · ${t("conversations.alsoKnownAs", { names: activeContact.match.others.map((o) => `${o.name} (${t(`conversations.match.${o.role}`)})`).join(", ") })}`
                          : ""}
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="gw-conv-thread-head__actions">
                  {activeKind === "client" && (
                    <>
                      <button
                        type="button"
                        className="pf-btn pf-btn--sm"
                        onClick={() =>
                          void dispatch(
                            assignConversationToMe({ clientId: activeId }),
                          )
                        }
                      >
                        {t("conversations.assignToMe")}
                      </button>
                      <Link
                        className="pf-btn pf-btn--sm"
                        to={`/admin/clients/${activeId}`}
                      >
                        {t("conversations.openClient")}
                      </Link>
                    </>
                  )}
                  {activeContact?.phone && (
                    <>
                      <button
                        type="button"
                        className="pf-btn pf-btn--sm"
                        onClick={() =>
                          openDialpadForCall(
                            activeContact.phone!,
                            activeKind === "client" ? activeId : undefined,
                            activeContact.display_name,
                          )
                        }
                      >
                        <Phone className="w-3.5 h-3.5" />
                        {t("conversations.call")}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="pf-btn pf-btn--sm"
                    onClick={() => {
                      const status =
                        activeContact?.status === "closed" ? "open" : "closed";
                      void dispatch(
                        setConversationContactStatus({
                          kind: activeKind,
                          contactId: activeId,
                          status,
                        }),
                      );
                    }}
                  >
                    {activeContact?.status === "closed"
                      ? t("conversations.reopen")
                      : t("conversations.close")}
                  </button>
                </div>
              </header>

              {activeKind === "unknown" && (
                <div className="gw-conv-unknown-tools">
                  <ConversationLinkClientPicker
                    value={linkClient}
                    onChange={setLinkClient}
                    disabled={unknownBusy}
                  />
                  <Busyish
                    busy={unknownBusy}
                    label={t("conversations.linkClient")}
                    onClick={async () => {
                      if (!linkClient?.id) return;
                      setUnknownBusy(true);
                      try {
                        await dispatch(
                          linkUnknownConversation({
                            unknownId: activeId,
                            client_id: linkClient.id,
                          }),
                        ).unwrap();
                        setLinkClient(null);
                        refreshInbox(true);
                        dispatch(selectConversationContact(null));
                      } finally {
                        setUnknownBusy(false);
                      }
                    }}
                  />
                  <Busyish
                    busy={unknownBusy}
                    label={t("conversations.createProspect")}
                    onClick={async () => {
                      setUnknownBusy(true);
                      try {
                        const r = await dispatch(
                          createProspectFromUnknown({ unknownId: activeId }),
                        ).unwrap();
                        dispatch(
                          selectConversationContact({
                            kind: "client",
                            id: r.client_id,
                          }),
                        );
                        refreshInbox(true);
                      } finally {
                        setUnknownBusy(false);
                      }
                    }}
                  />
                  <Busyish
                    busy={unknownBusy}
                    label={t("conversations.dismissUnknown")}
                    onClick={async () => {
                      setUnknownBusy(true);
                      try {
                        await dispatch(
                          dismissUnknownConversation({
                            unknownId: activeId,
                          }),
                        ).unwrap();
                        refreshInbox(true);
                      } finally {
                        setUnknownBusy(false);
                      }
                    }}
                  />
                </div>
              )}

              <div className="gw-conv-messages">
                {(timeline?.messages || []).map((m) => (
                  <div
                    key={m.id}
                    className={`gw-conv-bubble gw-conv-bubble--${m.direction}`}
                  >
                    {m.channel === "call" ? (
                      <div className="space-y-1">
                        <p className="text-sm font-medium">
                          {m.body || t("conversations.voiceCall")}
                        </p>
                        {m.call_duration_sec != null && (
                          <p className="text-xs text-muted-foreground">
                            {t("conversations.callDuration", {
                              sec: m.call_duration_sec,
                            })}
                          </p>
                        )}
                        {m.recording_url && (
                          <audio
                            controls
                            preload="none"
                            src={conversationMediaDisplayUrl(m.recording_url)}
                            className="w-full max-w-full"
                          />
                        )}
                        {m.transcript ? (
                          <details className="gw-conv-transcript">
                            <summary>{t("conversations.transcript")}</summary>
                            <p className="gw-conv-transcript__body">
                              {m.transcript}
                            </p>
                          </details>
                        ) : m.recording_url ? (
                          <CallTranscriptStatus messageId={m.id} status={m.transcript_status} />
                        ) : null}
                      </div>
                    ) : (
                      <>
                        {m.body && <p>{m.body}</p>}
                        {m.media_url && (
                          <button
                            type="button"
                            className="gw-conv-media-thumb"
                            onClick={() =>
                              setMediaPreview({
                                url: conversationMediaDisplayUrl(m.media_url),
                                contentType: m.media_content_type,
                              })
                            }
                          >
                            {String(m.media_content_type || "").startsWith(
                              "image/",
                            ) ? (
                              <img
                                src={conversationMediaDisplayUrl(m.media_url)}
                                alt=""
                              />
                            ) : (
                              t("conversations.media")
                            )}
                          </button>
                        )}
                      </>
                    )}
                    <div className="gw-conv-bubble__meta">
                      <time>
                        {formatConversationListTime(m.created_at, {
                          lang: timeLang,
                        })}
                      </time>
                      <ConversationMessageStatus
                        direction={m.direction}
                        providerStatus={m.provider_status}
                        errorMessage={m.error_message}
                      />
                    </div>
                  </div>
                ))}
                <div ref={threadEndRef} />
              </div>

              <div
                className={
                  composerCollapsed
                    ? "gw-conv-composer is-collapsed"
                    : "gw-conv-composer"
                }
              >
                <button
                  type="button"
                  className="gw-conv-composer__toggle"
                  onClick={() => setComposerCollapsed((v) => !v)}
                >
                  {composerCollapsed ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                  {t("conversations.composer")}
                </button>
                {!composerCollapsed && (
                  <>
                    {accessNumbers.length > 0 && (
                      <label className="text-xs flex flex-wrap items-center gap-2 mb-2">
                        <span>{t("conversations.fromNumber")}</span>
                        <select
                          className="pf-input"
                          value={threadFromId ?? ""}
                          onChange={(e) =>
                            setThreadFromId(Number(e.target.value) || null)
                          }
                        >
                          <option value="">{t("conversations.fromThreadLine")}</option>
                          {accessNumbers.map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.friendly_name || n.e164}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="gw-conv-suggestions">
                      {suggested.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="gw-chip"
                          onClick={() => setComposer(s.body)}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <ConversationMessageComposer
                      body={composer}
                      onBodyChange={setComposer}
                      channel={channel}
                      onChannelChange={setChannel}
                      templates={templates}
                      templateLang={mergeContext.preferred_language || templateLang}
                      mergeContext={mergeContext}
                      sending={sending}
                      sendError={
                        sendError ? translateApiError(t, sendError) : null
                      }
                      onSend={() => void sendActive()}
                      disabled={sending}
                      allowInternal={activeKind === "client"}
                      attachment={threadAttachment}
                      onAttachmentChange={setThreadAttachment}
                      uploadingMedia={uploadingMedia}
                      onPickMedia={(file) => pickMedia(file, setThreadAttachment)}
                    />
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <Modal
        open={showNew}
        titleKey="conversations.newMessage"
        onClose={() => setShowNew(false)}
      >
        <div className="space-y-3 max-w-full">
          <p className="text-sm text-muted-foreground">
            {t("conversations.newHint")}
          </p>
          <ConversationComposeTargetPicker
            value={composeTarget}
            onChange={setComposeTarget}
          />
          {accessNumbers.length > 1 && (
            <label className="text-xs flex flex-wrap items-center gap-2">
              <span>{t("conversations.fromNumber")}</span>
              <select
                className="pf-input"
                value={fromNumberId ?? ""}
                onChange={(e) =>
                  setFromNumberId(Number(e.target.value) || null)
                }
              >
                {accessNumbers.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.friendly_name || n.e164}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ConversationComposeAlsoSend
            recipients={alsoRecipients}
            onChange={setAlsoRecipients}
            disabled={sending}
          />
          <ConversationMessageComposer
            body={newBody}
            onBodyChange={setNewBody}
            channel={newChannel}
            onChannelChange={setNewChannel}
            templates={templates}
            templateLang={templateLang}
            mergeContext={{
              first_name:
                composeTarget?.kind === "client"
                  ? composeTarget.client.first_name
                  : composeTarget?.kind === "contact"
                    ? composeTarget.contact.first_name
                    : "",
              last_name:
                composeTarget?.kind === "client"
                  ? composeTarget.client.last_name
                  : composeTarget?.kind === "contact"
                    ? composeTarget.contact.last_name
                    : "",
              phone:
                composeTarget?.kind === "phone"
                  ? composeTarget.phone
                  : composeTarget?.kind === "client"
                    ? composeTarget.client.phone || ""
                    : composeTarget?.kind === "contact"
                      ? composeTarget.contact.phone || ""
                      : "",
            }}
            sending={sending}
            sendError={sendError ? translateApiError(t, sendError) : null}
            onSend={() => void sendNew()}
            disabled={sending}
            sendDisabled={!composeTarget}
            allowInternal={false}
            defaultTemplatesOpen
            attachment={composeAttachment}
            onAttachmentChange={setComposeAttachment}
            uploadingMedia={uploadingMedia}
            onPickMedia={(file) => pickMedia(file, setComposeAttachment)}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="pf-btn"
              onClick={() => {
                setShowNew(false);
                setAlsoRecipients([]);
                if (composeAttachment?.preview_url) {
                  URL.revokeObjectURL(composeAttachment.preview_url);
                }
                setComposeAttachment(null);
              }}
            >
              {t("conversations.close")}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={dialpadOpen}
        titleKey="conversations.dialpad"
        onClose={() => {
          setPendingDialClient(null);
          dispatch(setDialpadOpen(false));
          if (searchParams.get("dial") === "1") {
            const next = new URLSearchParams(searchParams);
            next.delete("dial");
            setSearchParams(next, { replace: true });
          }
        }}
        initialFocusRef={dialInputRef}
      >
        <div className="gw-dialpad">
          <input
            ref={dialInputRef}
            className="pf-input w-full text-center text-lg tabular-nums"
            value={dialDigits}
            onChange={(e) => setDialDigits(e.target.value)}
            placeholder={t("conversations.dialpadPlaceholder")}
            inputMode="tel"
            autoComplete="tel"
            disabled={dialing}
          />
          {!isAvailable ? (
            <p className="text-xs text-muted-foreground text-center" role="status">
              {t("conversations.dialpadNeedAvailable")}
            </p>
          ) : deviceStatus !== "ready" ? (
            <p className="text-xs text-muted-foreground text-center">
              {t(
                deviceStatus === "connecting"
                  ? "conversations.voiceConnecting"
                  : "conversations.voiceNotReady",
              )}
            </p>
          ) : null}
          {sendError ? (
            <p className="form-error text-center" role="alert">
              {translateApiError(t, sendError)}
            </p>
          ) : null}

          {dialpadOpen ? (
            <fieldset className="gw-dialpad__audio">
              <legend>{t("conversations.audioDevicesTitle")}</legend>
              <p className="text-xs text-muted-foreground">
                {t("conversations.dialpadAudioLead")}
              </p>
              <VoiceAudioDevicePicker
                deviceAudio={voiceDevice?.getDevice()?.audio ?? null}
              />
            </fieldset>
          ) : null}

          <div className="gw-dialpad__grid">
            {"123456789*0#".split("").map((d) => (
              <button
                key={d}
                type="button"
                className="pf-btn"
                disabled={dialing}
                onClick={() => setDialDigits((v) => v + d)}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              className="pf-btn"
              disabled={dialing}
              onClick={() => setDialDigits((v) => v.slice(0, -1))}
            >
              {t("conversations.dialpadBackspace")}
            </button>
            <button
              type="button"
              className="pf-btn pf-btn--primary"
              disabled={
                dialing ||
                !isAvailable ||
                deviceStatus === "error" ||
                deviceStatus === "offline"
              }
              onClick={() => {
                void (async () => {
                  if (!isAvailable) {
                    dispatch(
                      setConversationsSendError(
                        "conversations.dialpadNeedAvailable",
                      ),
                    );
                    return;
                  }
                  const ok = await placeCall(
                    dialDigits,
                    pendingDialClient?.id,
                    pendingDialClient?.name,
                  );
                  if (ok) {
                    setPendingDialClient(null);
                    dispatch(setDialpadOpen(false));
                  }
                })();
              }}
            >
              <Phone className="w-4 h-4" />
              {dialing
                ? t("conversations.dialing")
                : t("conversations.call")}
            </button>
            <button
              type="button"
              className="pf-btn pf-btn--primary"
              disabled={dialing}
              onClick={() => {
                const parsed = parseComposePhoneInput(dialDigits);
                if (!parsed) {
                  dispatch(
                    setConversationsSendError(
                      "conversations.invalidDialNumber",
                    ),
                  );
                  return;
                }
                setComposeTarget({
                  kind: "phone",
                  phone: parsed.phone,
                  label: parsed.label,
                });
                setShowNew(true);
                dispatch(setDialpadOpen(false));
              }}
            >
              <MessageSquare className="w-4 h-4" />
              {t("conversations.text")}
            </button>
          </div>
        </div>
      </Modal>

      <ConversationVoiceSettingsModal
        open={settingsOpen}
        onClose={() => dispatch(setVoiceSettingsOpen(false))}
      />
      <ConversationMediaLightbox
        open={!!mediaPreview}
        url={mediaPreview?.url || null}
        contentType={mediaPreview?.contentType}
        onClose={() => setMediaPreview(null)}
      />
    </div>
  );
}

function Busyish({
  busy,
  label,
  onClick,
}: {
  busy: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="pf-btn pf-btn--sm"
      disabled={busy}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/**
 * Transcript state under a recorded call: pending (Intelligence is working),
 * failed / unavailable, or never requested — with a Transcribe / Retry action.
 */
function CallTranscriptStatus({ messageId, status }: { messageId: number; status: string | null }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pending can still be checked (missed webhook) or started (no job yet).
  const canRetry = status !== "ready";
  return (
    <div className="gw-conv-transcript-status">
      <span className="text-xs text-muted-foreground">
        {t(`conversations.transcriptState.${status || "none"}`, {
          defaultValue: t("conversations.transcriptState.none"),
        })}
      </span>
      {canRetry ? (
        <button
          type="button"
          className="pf-btn pf-btn--sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await dispatch(retryCallTranscript({ messageId }));
            if (retryCallTranscript.rejected.match(r)) setError(r.payload || "errors.server");
            setBusy(false);
          }}
        >
          {busy
            ? t("pf.busy.sending")
            : t(
                status === "failed"
                  ? "conversations.transcriptRetry"
                  : status === "pending"
                    ? "conversations.transcriptCheck"
                    : "conversations.transcriptStart",
              )}
        </button>
      ) : null}
      <ErrorNote error={error} />
    </div>
  );
}

/** Where a matched phone number's record lives. */
function matchPath(role: string, id: number, phone?: string | null): string {
  switch (role) {
    case "client":
      return `/admin/clients/${id}`;
    case "affiliate":
      return `/admin/affiliates/${id}`;
    case "contractor":
      return `/admin/contractors/${id}`;
    case "contact":
      return `/admin/contacts?q=${encodeURIComponent(phone || "")}`;
    case "lead":
      return `/admin/leads?q=${encodeURIComponent(phone || "")}`;
    default:
      return "/admin/staff";
  }
}
