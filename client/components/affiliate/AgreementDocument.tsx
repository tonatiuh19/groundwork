import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";

/** Only our own pages, https and mailto links render as links (anything else stays plain text). */
function safeHref(href: string): { internal: boolean; href: string } | null {
  if (/^\/(?![\/\\])/.test(href)) return { internal: true, href };
  if (/^(https:\/\/|mailto:)/i.test(href)) return { internal: false, href };
  return null;
}

/** **bold** and [text](url) spans inside a line. */
function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/)
    .filter(Boolean)
    .map((seg, i) => {
      if (seg.startsWith("**") && seg.endsWith("**")) return <strong key={i}>{seg.slice(2, -2)}</strong>;
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(seg);
      const link = m ? safeHref(m[2]) : null;
      if (m && link)
        return link.internal ? (
          <Link key={i} className="text-link" to={link.href}>
            {m[1]}
          </Link>
        ) : (
          <a key={i} className="text-link" href={link.href} target="_blank" rel="noopener noreferrer">
            {m[1]}
          </a>
        );
      return <Fragment key={i}>{m ? m[1] : seg}</Fragment>;
    });
}

/**
 * Renders the agreement template markup (same rules as the signed PDF):
 * `# ` title, `## ` section, `- ` bullet, `| a | b |` table rows (first = header),
 * `**bold**`. Wide tables scroll inside their own wrapper on phones.
 */
export default function AgreementDocument({ body }: { body: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let rows: string[][] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`l${blocks.length}`}>
          {list.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
    if (rows.length) {
      const [head, ...rest] = rows;
      blocks.push(
        <div className="gw-agreement-table" key={`t${blocks.length}`}>
          <table>
            <thead>
              <tr>{head.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {rest.map((r, ri) => (
                <tr key={ri}>{r.map((c, i) => <td key={i}>{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      rows = [];
    }
  };
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("|")) {
      if (list.length) flush();
      rows.push(line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      continue;
    }
    if (line.startsWith("- ")) {
      if (rows.length) flush();
      list.push(line.slice(2));
      continue;
    }
    flush();
    if (!line.trim()) continue;
    if (line.startsWith("# ")) blocks.push(<h2 key={blocks.length}>{inline(line.slice(2))}</h2>);
    else if (line.startsWith("## ")) blocks.push(<h3 key={blocks.length}>{inline(line.slice(3))}</h3>);
    else if (line.startsWith("### ")) blocks.push(<h4 key={blocks.length}>{inline(line.slice(4))}</h4>);
    else blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <article className="gw-agreement-doc">{blocks}</article>;
}

/** Client-side preview of the server's placeholder fill (server re-renders at signing). */
export function previewAgreement(
  body: string,
  vars: { date: string; party: string; price: string },
): string {
  const map: Record<string, string> = {
    effective_date: vars.date,
    affiliate_party: vars.party,
    subscription_price: vars.price,
  };
  return body.replace(/\{\{(\w+)\}\}/g, (m, k) => map[k] ?? m);
}
