import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Bold, Italic, Link2, List, ListOrdered, Underline, type LucideIcon } from "lucide-react";

/**
 * Small rich-text editor for emails and signatures: bold, italic, underline,
 * lists and links. Emits HTML. Uncontrolled after mount (the caret never jumps);
 * pass a new `resetKey` to load different `initialHtml`.
 */
export default function RichEditor({
  initialHtml = "",
  resetKey,
  onChange,
  placeholder,
  minHeight = 180,
  ariaLabel,
}: {
  initialHtml?: string;
  resetKey?: string | number;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  ariaLabel: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const run = (cmd: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, value);
    onChange(ref.current?.innerHTML || "");
  };
  const tools: Array<{ cmd: string; icon: LucideIcon; label: string }> = [
    { cmd: "bold", icon: Bold, label: t("mail.editor.bold") },
    { cmd: "italic", icon: Italic, label: t("mail.editor.italic") },
    { cmd: "underline", icon: Underline, label: t("mail.editor.underline") },
    { cmd: "insertUnorderedList", icon: List, label: t("mail.editor.bullets") },
    { cmd: "insertOrderedList", icon: ListOrdered, label: t("mail.editor.numbers") },
  ];

  return (
    <div className="gw-rte">
      <div className="gw-rte__bar" role="toolbar" aria-label={ariaLabel}>
        {tools.map(({ cmd, icon: Icon, label }) => (
          <button key={cmd} type="button" className="gw-rte__btn" title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={() => run(cmd)}>
            <Icon size={15} aria-hidden />
          </button>
        ))}
        <button
          type="button"
          className="gw-rte__btn"
          title={t("mail.editor.link")}
          aria-label={t("mail.editor.link")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const url = window.prompt(t("mail.editor.linkPrompt"), "https://");
            if (url && /^(https?:|mailto:|tel:)/i.test(url.trim())) run("createLink", url.trim());
          }}
        >
          <Link2 size={15} aria-hidden />
        </button>
      </div>
      <div
        ref={ref}
        className="gw-rte__area"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        style={{ minHeight }}
        onInput={() => onChange(ref.current?.innerHTML || "")}
        onPaste={(e) => {
          // Paste as plain text: keeps emails clean (no foreign styles or scripts).
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
      />
    </div>
  );
}
