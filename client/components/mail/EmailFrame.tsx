import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageOff } from "lucide-react";

const ALLOW_KEY = "gw-mail-images-allow";

/** Senders whose images this viewer chose to always load (per browser, a convenience). */
function allowedSenders(): string[] {
  try {
    return JSON.parse(localStorage.getItem(ALLOW_KEY) || "[]");
  } catch {
    return [];
  }
}
function allowSender(email: string) {
  try {
    localStorage.setItem(ALLOW_KEY, JSON.stringify([...new Set([...allowedSenders(), email])].slice(-500)));
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
}

/** Remote images (and CSS backgrounds) off: senders can't see when an email is opened. Inline cid images keep loading. */
function blockRemote(html: string): { html: string; blocked: number } {
  let blocked = 0;
  const out = html
    .replace(/(<img\b[^>]*?)\ssrc\s*=\s*(["'])(https?:)?\/\/([^"']*)\2/gi, (_m, pre, q, proto, rest) => {
      blocked++;
      return `${pre} data-gw-src=${q}${proto || "https:"}//${rest}${q}`;
    })
    .replace(/(<img\b[^>]*?)\ssrcset\s*=\s*(["'])[^"']*\2/gi, "$1")
    .replace(/url\(\s*(["']?)(https?:)?\/\/[^)]*\)/gi, () => {
      blocked++;
      return "none";
    })
    .replace(/(<(?:td|table|body|div)\b[^>]*?)\sbackground\s*=\s*(["'])(https?:)?\/\/[^"']*\2/gi, (_m, pre) => {
      blocked++;
      return pre;
    });
  return { html: out, blocked };
}

/**
 * Renders email HTML in a sandboxed iframe (no scripts; links open in a new
 * tab) and grows to fit its content, so email styles never leak into the app.
 * Remote images stay hidden until the viewer loads them (or always allows the sender).
 */
export default function EmailFrame({ html, title, sender }: { html: string; title: string; sender?: string | null }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const senderKey = String(sender || "").toLowerCase();
  const [show, setShow] = useState(() => Boolean(senderKey && allowedSenders().includes(senderKey)));
  const shaped = useMemo(() => (show ? { html, blocked: 0 } : blockRemote(html)), [html, show]);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<style>
  html,body{margin:0;padding:0;background:#fff;color:#1f2933;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere}
  body{padding:2px 2px 8px}
  img{max-width:100%;height:auto}
  img[data-gw-src]{display:inline-block;min-width:16px;min-height:16px;background:#f1ece1;border-radius:4px}
  table{max-width:100%!important}
  pre{white-space:pre-wrap}
  a{color:#9a6b12}
  blockquote{margin:8px 0;padding-left:10px;border-left:3px solid #e5e7eb;color:#52606d}
</style></head><body>${shaped.html}</body></html>`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let ro: ResizeObserver | null = null;
    const fit = () => {
      const body = el.contentDocument?.body;
      if (body) setHeight(Math.min(20000, Math.max(60, body.scrollHeight + 12)));
    };
    const onLoad = () => {
      fit();
      const body = el.contentDocument?.body;
      if (body && "ResizeObserver" in window) {
        ro = new ResizeObserver(fit);
        ro.observe(body);
      }
      el.contentDocument?.querySelectorAll("img").forEach((img) => img.addEventListener("load", fit));
    };
    el.addEventListener("load", onLoad);
    return () => {
      el.removeEventListener("load", onLoad);
      ro?.disconnect();
    };
  }, [shaped.html]);

  // Nothing to show (no text, no images): say so instead of an empty white box.
  const empty = !/<(img|table|svg)\b/i.test(html) && !html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "").replace(/&nbsp;|\s/g, "");
  if (empty) return <p className="pf-muted gw-mail-empty">{t("mail.emptyBody")}</p>;

  return (
    <>
      {shaped.blocked > 0 ? (
        <div className="gw-mail-images" role="status">
          <ImageOff size={14} aria-hidden />
          <span>{t("mail.imagesHidden")}</span>
          <button type="button" className="gw-linkbtn" onClick={() => setShow(true)}>
            {t("mail.loadImages")}
          </button>
          {senderKey ? (
            <button
              type="button"
              className="gw-linkbtn"
              onClick={() => {
                allowSender(senderKey);
                setShow(true);
              }}
            >
              {t("mail.alwaysLoadFrom", { email: senderKey })}
            </button>
          ) : null}
        </div>
      ) : null}
      <iframe
        ref={ref}
        className="gw-mail-frame"
        title={title}
        srcDoc={doc}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        style={{ height }}
      />
    </>
  );
}
