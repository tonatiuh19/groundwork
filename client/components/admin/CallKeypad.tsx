import { useEffect, useRef, useState } from "react";
import type { Call } from "@twilio/voice-sdk";
import { useTranslation } from "react-i18next";
import { Delete, Send } from "lucide-react";
import { logger } from "@/utils/logger";
import { cn } from "@/lib/cn";

const KEYS: Array<[string, string]> = [
  ["1", ""],
  ["2", "ABC"],
  ["3", "DEF"],
  ["4", "GHI"],
  ["5", "JKL"],
  ["6", "MNO"],
  ["7", "PQRS"],
  ["8", "TUV"],
  ["9", "WXYZ"],
  ["*", ""],
  ["0", "+"],
  ["#", ""],
];

/** Touch-tone digits Twilio accepts; "w" = half-second wait (e.g. "w123#" for an extension). */
export const DTMF_RE = /^[0-9*#w]+$/;

/**
 * In-call keypad (DTMF): tap keys or type on the keyboard to dial an extension, pick a menu
 * option or re-record a voicemail greeting. Also sends a whole sequence at once ("123#").
 */
export default function CallKeypad({ call }: { call: Call | null }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const [seq, setSeq] = useState("");
  const [pressed, setPressed] = useState<string | null>(null);
  const [, rerender] = useState(0);
  const open = Boolean(call) && call?.status() === "open";
  const timer = useRef<number | null>(null);

  // Keys unlock when the call connects (outbound calls ring first).
  useEffect(() => {
    if (!call) return;
    const bump = () => rerender((n) => n + 1);
    call.on("accept", bump);
    call.on("disconnect", bump);
    call.on("cancel", bump);
    return () => {
      call.removeListener("accept", bump);
      call.removeListener("disconnect", bump);
      call.removeListener("cancel", bump);
    };
  }, [call]);

  const send = (digits: string) => {
    if (!call || !open || !DTMF_RE.test(digits)) return;
    try {
      call.sendDigits(digits);
      setTyped((v) => `${v}${digits.replace(/w/g, "")}`.slice(-24));
      if (digits.length === 1) {
        setPressed(digits);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setPressed(null), 160);
      }
    } catch (e) {
      logger.warn("voice", "sendDigits failed", e);
    }
  };

  // Physical keyboard: 0-9 * # while the keypad is open (not while typing in the sequence box).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (/^[0-9*#]$/.test(e.key)) {
        e.preventDefault();
        send(e.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="gw-keypad" role="group" aria-label={t("conversations.keypad")}>
      <output className="gw-keypad__display" aria-live="polite">
        {typed || <span className="gw-keypad__hint">{open ? t("conversations.keypadHint") : t("conversations.keypadWaiting")}</span>}
        {typed ? (
          <button type="button" className="gw-keypad__clear" aria-label={t("conversations.keypadClear")} onClick={() => setTyped("")}>
            <Delete size={15} />
          </button>
        ) : null}
      </output>
      <div className="gw-keypad__grid">
        {KEYS.map(([k, sub]) => (
          <button key={k} type="button" className={cn("gw-keypad__key", pressed === k && "is-pressed")} disabled={!open} onClick={() => send(k)} aria-label={k}>
            <span className="gw-keypad__digit">{k}</span>
            <span className="gw-keypad__sub" aria-hidden>
              {sub}
            </span>
          </button>
        ))}
      </div>
      <form
        className="gw-keypad__seq"
        onSubmit={(e) => {
          e.preventDefault();
          const s = seq.replace(/[\s-]/g, "").replace(/,/g, "w");
          if (!DTMF_RE.test(s)) return;
          send(s);
          setSeq("");
        }}
      >
        <input
          value={seq}
          inputMode="tel"
          placeholder={t("conversations.keypadSeqPh")}
          aria-label={t("conversations.keypadSeq")}
          onChange={(e) => setSeq(e.target.value.replace(/[^0-9*#,\s-]/g, "").slice(0, 32))}
          disabled={!open}
        />
        <button type="submit" className="pf-btn" disabled={!open || !seq.trim()}>
          <Send size={14} /> {t("conversations.keypadSend")}
        </button>
      </form>
    </div>
  );
}
