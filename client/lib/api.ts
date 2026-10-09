import axios from "axios";
import i18n from "@/i18n";

export const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  config.headers.set("Accept-Language", lang);
  return config;
});

/** Prefer i18n keys from the API (`validation.*`, `errors.*`); fall back to raw text. */
export function formatAxiosError(
  error: unknown,
  fallbackKey = "errors.submitFailed",
): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { error?: string; message?: string }
      | undefined;
    return data?.error || data?.message || error.message || fallbackKey;
  }
  if (error instanceof Error) return error.message || fallbackKey;
  return fallbackKey;
}

/** Translate API error keys; leave plain English/legacy strings untouched. */
export function translateApiError(
  t: (key: string) => string,
  error: string | null | undefined,
): string {
  if (!error) return "";
  // i18n keys are dotted identifiers (no spaces); plain messages pass through.
  if (/^[a-z][a-zA-Z0-9_.]*$/.test(error)) return t(error);
  return error;
}
