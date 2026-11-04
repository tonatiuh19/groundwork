import { useFormikContext } from "formik";
import { useTranslation } from "react-i18next";
import { Landmark, Mail, Phone } from "lucide-react";
import type { Lender } from "@shared/api";
import { SelectField } from "@/components/portal/kit";

/**
 * Lender from the Lenders directory + the chosen lender's contact (name, phone, email)
 * right beside it. Used on clients and projects.
 */
export default function LenderSelectWithCard({
  name,
  lenders,
  currentId,
  disabled,
  labelKey = "lenders.pick",
}: {
  name: string;
  lenders: Lender[];
  currentId: number | null;
  disabled?: boolean;
  labelKey?: string;
}) {
  const { t } = useTranslation();
  const { values } = useFormikContext<Record<string, string>>();
  const picked = lenders.find((l) => String(l.id) === String(values[name] || ""));
  return (
    <div className="gw-lender-pick">
      <SelectField
        name={name}
        labelKey={labelKey}
        disabled={disabled}
        options={[
          { value: "", label: t("lenders.none") },
          ...lenders.filter((l) => l.is_active || l.id === currentId).map((l) => ({ value: String(l.id), label: l.company })),
        ]}
      />
      {picked ? (
        <div className="gw-lender-card">
          <span className="gw-lender-card__icon" aria-hidden>
            <Landmark size={15} />
          </span>
          <div className="gw-lender-card__body">
            <strong>{picked.contact_name || picked.company}</strong>
            {picked.contact_name ? <small>{picked.company}</small> : null}
            {picked.phone ? (
              <a href={`tel:${picked.phone}`}>
                <Phone size={12} aria-hidden /> {picked.phone}
              </a>
            ) : null}
            {picked.email ? (
              <a href={`mailto:${picked.email}`}>
                <Mail size={12} aria-hidden /> {picked.email}
              </a>
            ) : null}
            {picked.nmls_number ? <small>NMLS {picked.nmls_number}</small> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
