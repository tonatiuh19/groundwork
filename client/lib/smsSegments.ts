/** Rough SMS segment helper (GSM-7 / UCS-2). Enough for composer UX. */
export const SMS_MAX_BODY_CHARS = 1600;

export function smsSegmentInfo(text: string): {
  length: number;
  segments: number;
  encoding: "gsm" | "ucs2";
} {
  const s = String(text || "");
  const length = [...s].length;
  // UCS-2 if any non-GSM-ish character
  const ucs2 = /[^\x00-\x7F]/.test(s);
  if (!length) return { length: 0, segments: 0, encoding: "gsm" };
  if (ucs2) {
    const per = length <= 70 ? 70 : 67;
    return { length, segments: Math.ceil(length / per), encoding: "ucs2" };
  }
  const per = length <= 160 ? 160 : 153;
  return { length, segments: Math.ceil(length / per), encoding: "gsm" };
}
