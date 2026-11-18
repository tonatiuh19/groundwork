import { useEffect, useRef } from "react";
import { useAppDispatch } from "@/store/hooks";
import { primeShield, registerShieldTrap, type ShieldForm } from "@/store/slices/spamShieldSlice";

/**
 * Invisible part of the spam shield, placed inside a public form: a trap field people never see or
 * reach (off-screen, not focusable, ignored by password managers) that bots fill in, and the background
 * challenge for this form (refreshed every hour while the page is open).
 */
export default function SpamShieldTrap({ form }: { form: ShieldForm }) {
  const dispatch = useAppDispatch();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void dispatch(primeShield(form));
    const id = window.setInterval(() => void dispatch(primeShield(form)), 15 * 60 * 1000);
    const off = registerShieldTrap(form, () => ref.current?.value ?? "");
    return () => {
      window.clearInterval(id);
      off();
    };
  }, [dispatch, form]);
  return (
    <div className="gw-shield-trap" aria-hidden="true">
      <label>
        Website
        <input ref={ref} type="text" name="company_website" tabIndex={-1} autoComplete="off" data-1p-ignore data-lpignore="true" defaultValue="" />
      </label>
    </div>
  );
}
