import * as Yup from "yup";
import {
  isReservedAffiliateSlug,
  isValidAffiliateSlugFormat,
  slugifyAffiliate,
} from "@/lib/affiliateSlug";

/** Phone required: at least 10 digits after stripping non-digits (matches API). */
export function yupPhoneRequired(minMessage: string, requiredMessage?: string) {
  return Yup.string()
    .trim()
    .required(requiredMessage || minMessage)
    .test("phone-digits", minMessage, (v) => {
      if (!v) return false;
      return v.replace(/\D/g, "").length >= 10;
    });
}

/** Optional phone: empty OK; otherwise ≥10 digits. */
export function yupPhoneOptional(message: string) {
  return Yup.string()
    .trim()
    .test("phone-digits", message, (v) => {
      if (!v) return true;
      return v.replace(/\D/g, "").length >= 10;
    });
}

/** Optional affiliate vanity slug (empty clears; format + reserved match API). */
export function yupAffiliateSlug(formatMessage: string, reservedMessage: string) {
  return Yup.string()
    .trim()
    .test("affiliate-slug-format", formatMessage, (v) => {
      if (!v) return true;
      return isValidAffiliateSlugFormat(slugifyAffiliate(v));
    })
    .test("affiliate-slug-reserved", reservedMessage, (v) => {
      if (!v) return true;
      return !isReservedAffiliateSlug(slugifyAffiliate(v));
    });
}
