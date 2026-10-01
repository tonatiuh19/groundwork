import { useTranslation } from "react-i18next";

const LANGS = [
  { code: "en" as const, shortKey: "lang.enShort", fullKey: "lang.en" },
  { code: "es" as const, shortKey: "lang.esShort", fullKey: "lang.es" },
];

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const active = i18n.language?.startsWith("es") ? "es" : "en";
  const activeIndex = active === "es" ? 1 : 0;

  const setLang = (code: "en" | "es") => {
    if (code === active) return;
    void i18n.changeLanguage(code);
  };

  return (
    <div
      className="lang-switcher"
      role="group"
      aria-label={t("lang.aria")}
    >
      <span
        className="lang-switcher-thumb"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
        aria-hidden
      />
      {LANGS.map(({ code, shortKey, fullKey }) => {
        const isActive = active === code;
        return (
          <button
            key={code}
            type="button"
            className={`lang-switcher-btn${isActive ? " is-active" : ""}`}
            aria-pressed={isActive}
            aria-label={t(fullKey)}
            onClick={() => setLang(code)}
          >
            {t(shortKey)}
          </button>
        );
      })}
    </div>
  );
}
