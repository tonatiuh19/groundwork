import {
  useEffect,
  useId,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

const LENGTH = 6;

type Props = {
  value: string;
  onChange: (code: string) => void;
  /** Fires once when six digits are present (typing or paste). */
  onComplete?: (code: string) => void;
  disabled?: boolean;
  verifying?: boolean;
  label: string;
  autoFocus?: boolean;
};

function onlyDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, LENGTH);
}

export default function OtpCodeInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  verifying = false,
  label,
  autoFocus = true,
}: Props) {
  const { t } = useTranslation();
  const baseId = useId();
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const completedRef = useRef<string | null>(null);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? "");

  useEffect(() => {
    if (autoFocus && !disabled && !verifying) {
      inputsRef.current[0]?.focus();
    }
  }, [autoFocus, disabled, verifying]);

  useEffect(() => {
    if (value.length === LENGTH && /^\d{6}$/.test(value)) {
      if (completedRef.current !== value) {
        completedRef.current = value;
        onComplete?.(value);
      }
    } else {
      completedRef.current = null;
    }
  }, [value, onComplete]);

  const setDigits = (next: string[]) => {
    onChange(next.join("").slice(0, LENGTH));
  };

  const focusAt = (index: number) => {
    const el = inputsRef.current[Math.max(0, Math.min(LENGTH - 1, index))];
    el?.focus();
    el?.select();
  };

  const handleChange = (index: number, e: ChangeEvent<HTMLInputElement>) => {
    const raw = onlyDigits(e.target.value);
    if (!raw) {
      const next = [...digits];
      next[index] = "";
      setDigits(next);
      return;
    }
    // SMS / OS autofill may dump the whole code into one box
    if (raw.length > 1) {
      const filled = Array.from({ length: LENGTH }, (_, i) => raw[i] ?? "");
      setDigits(filled);
      focusAt(Math.min(raw.length, LENGTH) - 1);
      return;
    }
    const next = [...digits];
    next[index] = raw;
    setDigits(next);
    if (index < LENGTH - 1) focusAt(index + 1);
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...digits];
      if (next[index]) {
        next[index] = "";
        setDigits(next);
      } else if (index > 0) {
        next[index - 1] = "";
        setDigits(next);
        focusAt(index - 1);
      }
      return;
    }
    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      focusAt(index - 1);
    }
    if (e.key === "ArrowRight" && index < LENGTH - 1) {
      e.preventDefault();
      focusAt(index + 1);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = onlyDigits(e.clipboardData.getData("text"));
    if (!pasted) return;
    const filled = Array.from({ length: LENGTH }, (_, i) => pasted[i] ?? "");
    setDigits(filled);
    focusAt(Math.min(pasted.length, LENGTH) - 1);
  };

  const locked = disabled || verifying;

  return (
    <div
      className={`otp-code${verifying ? " otp-code--verifying" : ""}`}
      role="group"
      aria-label={label}
      aria-busy={verifying || undefined}
    >
      <span className="otp-code-label" id={`${baseId}-label`}>
        {label}
      </span>
      <div className="otp-code-boxes" aria-labelledby={`${baseId}-label`}>
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            className="otp-code-box"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            name={i === 0 ? "otp" : undefined}
            maxLength={LENGTH}
            value={digit}
            disabled={locked}
            aria-label={t("portalAuth.digitOf", {
              current: i + 1,
              total: LENGTH,
            })}
            onChange={(e) => handleChange(i, e)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
          />
        ))}
        {verifying ? (
          <div className="otp-code-loader" aria-live="polite">
            <span className="otp-code-ring" aria-hidden />
            <Loader2 className="spin" size={18} />
            <span>{t("portalAuth.verifying")}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
