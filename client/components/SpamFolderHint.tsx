import { MailWarning } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

/** "Don't see our email? Check spam / junk": shown on every screen that promises an email. */
export default function SpamFolderHint({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={cn("spam-hint", className)}>
      <MailWarning size={15} aria-hidden /> {t("form.spamHint")}
    </p>
  );
}
