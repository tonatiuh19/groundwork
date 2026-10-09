/** Classify Conversations MMS / attachment URLs for thumbnails + lightbox. */

export type ConversationMediaKind = "image" | "video" | "audio" | "pdf" | "file";

export function classifyConversationMedia(
  url: string,
  contentType?: string | null,
): ConversationMediaKind {
  const ct = String(contentType || "").toLowerCase();
  const u = String(url || "");
  if (ct.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic)(\?|$)/i.test(u)) {
    return "image";
  }
  if (ct.startsWith("video/") || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u)) {
    return "video";
  }
  if (ct.startsWith("audio/") || /\.(mp3|wav|m4a|ogg|aac)(\?|$)/i.test(u)) {
    return "audio";
  }
  if (ct.includes("pdf") || /\.pdf(\?|$)/i.test(u)) {
    return "pdf";
  }
  return "file";
}

/** Twilio media needs admin cookie proxy; Blob URLs are public. */
export function conversationMediaDisplayUrl(url: string | null | undefined): string {
  const u = String(url || "").trim();
  if (!u) return "";
  if (
    u.startsWith("https://api.twilio.com/") ||
    /twilio\.com\/.*Recordings/i.test(u)
  ) {
    return `/api/conversations/media?url=${encodeURIComponent(u)}`;
  }
  return u;
}
