import { Printer, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CityDetail } from "@shared/api";
import { useFormatters } from "@/lib/format";

export type CityPrintKind = "intel" | "leave_behind" | "agenda";

/**
 * Peter's printable forms, filled from the city's data (no outside AI): the city intelligence sheet,
 * a leave-behind for city leaders, and a two-part meeting agenda. Uses the browser's print / save as PDF.
 */
export default function CityPrint({ kind, detail, onClose }: { kind: CityPrintKind; detail: CityDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const c = detail.city;
  const byKind = (k: string) => detail.contacts.filter((x) => x.kind === k);
  const lastMeeting = detail.activities.find((a) => a.activity_type === "meeting" || a.activity_type === "presentation");
  return (
    <div className="gw-print-overlay" role="dialog" aria-modal="true" aria-label={t(`cityPartner.print.${kind}`)}>
      <div className="gw-print-bar">
        <button type="button" className="pf-btn pf-btn--sm" onClick={() => window.print()}>
          <Printer size={14} aria-hidden /> {t("cityPartner.print.print")}
        </button>
        <button type="button" className="pf-btn pf-btn--sm" onClick={onClose}>
          <X size={14} aria-hidden /> {t("cityPartner.print.close")}
        </button>
      </div>
      <article className="gw-print-sheet">
        <header>
          <img src="/logos/groundwork-logo.png" alt="Groundwork Capital Group" />
          <div>
            <h1>{t(`cityPartner.print.${kind}`)}</h1>
            <p>
              {c.name}
              {c.county ? `, ${c.county} County` : ""} · {fmt.date(new Date())}
            </p>
          </div>
        </header>
        {kind === "intel" ? (
          <>
            <h2>{t("cityPartner.intel.council")}</h2>
            <p>{detail.intel?.council_summary || t("cityPartner.print.blank")}</p>
            {(["elected", "planning", "building", "city_staff"] as const).map((k) => (
              <section key={k}>
                <h2>{t(`cityPartner.contactKind.${k}`)}</h2>
                {byKind(k).length ? (
                  <table>
                    <tbody>
                      {byKind(k).map((x) => (
                        <tr key={x.id}>
                          <td>{x.name}</td>
                          <td>{x.title}</td>
                          <td>{x.email}</td>
                          <td>{x.phone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p>{t("cityPartner.print.blank")}</p>
                )}
              </section>
            ))}
            <h2>{t("cityPartner.intel.aduStatus")}</h2>
            <p>
              {t(`cityPartner.adu.${detail.intel?.adu_program_status || "unknown"}`)}
              {detail.intel?.adu_program_notes ? `. ${detail.intel.adu_program_notes}` : ""}
            </p>
            <h2>{t("cityPartner.intel.sources")}</h2>
            <p>{detail.intel?.intel_sources || t("cityPartner.print.blank")}</p>
            <p className="gw-print-foot">{detail.intel?.intel_verified_at ? t("cityPartner.print.verifiedOn", { date: fmt.date(detail.intel.intel_verified_at) }) : t("cityPartner.print.notVerified")}</p>
          </>
        ) : null}
        {kind === "leave_behind" ? (
          <>
            <h2>{t("cityPartner.print.lbTitle", { city: c.name })}</h2>
            <p>{t("cityPartner.print.lbIntro", { city: c.name })}</p>
            <ul>
              <li>{t("cityPartner.print.lbPoint1")}</li>
              <li>{t("cityPartner.print.lbPoint2")}</li>
              <li>{t("cityPartner.print.lbPoint3")}</li>
              <li>{t("cityPartner.print.lbPoint4")}</li>
            </ul>
            <h2>{t("cityPartner.print.lbAsk")}</h2>
            <p>{t("cityPartner.print.lbAskText", { city: c.name })}</p>
            <p className="gw-print-foot">Groundwork Capital Group · (866) 864-7506 · info@groundworkcapitalgroup.com</p>
          </>
        ) : null}
        {kind === "agenda" ? (
          <>
            <h2>{t("cityPartner.print.agendaPart1")}</h2>
            <ol>
              <li>{t("cityPartner.print.agenda1a")}</li>
              <li>{t("cityPartner.print.agenda1b", { city: c.name })}</li>
              <li>{t("cityPartner.print.agenda1c")}</li>
            </ol>
            <h2>{t("cityPartner.print.agendaPart2")}</h2>
            <ol>
              <li>{t("cityPartner.print.agenda2a")}</li>
              <li>{t("cityPartner.print.agenda2b")}</li>
              <li>{t("cityPartner.print.agenda2c")}</li>
            </ol>
            <h2>{t("cityPartner.print.agendaContext")}</h2>
            <p>
              {t(`cityPartner.stage.${c.pipeline_stage || "none"}`)}
              {lastMeeting ? ` · ${t("cityPartner.print.lastMeeting", { date: fmt.date(`${lastMeeting.occurred_on}T12:00:00`), summary: lastMeeting.summary })}` : ""}
            </p>
            {c.next_action ? <p>{t("cityPartner.print.nextAction", { action: c.next_action })}</p> : null}
          </>
        ) : null}
      </article>
    </div>
  );
}
