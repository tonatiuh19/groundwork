import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addCity, fetchSimilarCities } from "@/store/slices/citiesSlice";
import { Modal } from "@/components/portal/Modal";
import { BusyButton, ErrorNote } from "@/components/portal/kit";

/**
 * Quick add from any city picker. Warns about near-duplicates ("Fontona" vs Fontana) and offers the
 * existing city first, so the list stays clean.
 */
export default function CityCreateModal({ initialName, onClose, onPicked }: { initialName: string | null; onClose: () => void; onPicked: (id: number) => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { saving, error } = useAppSelector((s) => s.cities);
  const [name, setName] = useState("");
  const [matches, setMatches] = useState<{ id: number; name: string; archived: boolean }[]>([]);
  useEffect(() => {
    if (initialName !== null) setName(initialName);
  }, [initialName]);
  useEffect(() => {
    const n = name.trim();
    if (n.length < 3) return setMatches([]);
    const h = window.setTimeout(async () => {
      const r = await dispatch(fetchSimilarCities(n));
      if (fetchSimilarCities.fulfilled.match(r)) setMatches(r.payload.matches);
    }, 250);
    return () => window.clearTimeout(h);
  }, [dispatch, name]);
  return (
    <Modal open={initialName !== null} titleKey="cities.quickAddTitle" onClose={onClose}>
      <div className="pf-form">
        <label className="pf-field">
          <span>{t("cities.name")}</span>
          <input value={name} maxLength={100} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        {matches.length ? (
          <div className="gw-qr-warn">
            <p>{t("cities.similarFound")}</p>
            <div className="pf-actions">
              {matches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="pf-btn pf-btn--sm"
                  disabled={m.archived}
                  onClick={() => {
                    onPicked(m.id);
                    onClose();
                  }}
                >
                  {m.archived ? t("cities.useArchived", { name: m.name }) : t("cities.useExisting", { name: m.name })}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <ErrorNote error={error} />
        <div className="pf-actions">
          <a className="pf-btn" href="/admin/settings#cities">
            {t("cities.manage")}
          </a>
          <BusyButton
            tone="gold"
            label={matches.length ? t("cities.addAnyway") : t("cities.add")}
            busy={saving}
            disabled={!name.trim()}
            onClick={async () => {
              const r = await dispatch(addCity(name.trim()));
              if (addCity.fulfilled.match(r)) {
                onPicked(r.payload.id);
                onClose();
              }
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
