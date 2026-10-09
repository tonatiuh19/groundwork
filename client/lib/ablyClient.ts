import * as AblyLib from "ably";

/**
 * Shared Ably Realtime client for admin shell (notifications + conversations).
 * Token minting stays in Redux; this module only opens one websocket and
 * re-auths via a refreshable TokenRequest fetcher (no frozen first token).
 */

export type AblyTokenFetcher = () => Promise<AblyLib.TokenRequest | null>;

let tokenFetcher: AblyTokenFetcher | null = null;
let client: AblyLib.Realtime | null = null;
let connectPromise: Promise<AblyLib.Realtime | null> | null = null;
let permanentlyUnavailable = false;

export function isAblyPermanentlyUnavailable(): boolean {
  return permanentlyUnavailable;
}

export function markAblyUnavailable(): void {
  permanentlyUnavailable = true;
  closeSharedAblyClient();
}

export function closeSharedAblyClient(): void {
  if (client) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
    client = null;
  }
  connectPromise = null;
}

/** Register (or clear) the auth provider used by ensureSharedAblyClient. */
export function setAblyTokenFetcher(fetcher: AblyTokenFetcher | null): void {
  tokenFetcher = fetcher;
}

/**
 * Open (or reuse) the shared Realtime client. AuthCallback re-invokes the
 * fetcher whenever Ably needs a new TokenRequest — safe for long sessions.
 */
export async function ensureSharedAblyClient(): Promise<AblyLib.Realtime | null> {
  if (permanentlyUnavailable) return null;
  if (client) return client;
  if (connectPromise) return connectPromise;
  if (!tokenFetcher) return null;

  connectPromise = (async () => {
    try {
      const first = await tokenFetcher!();
      if (!first) {
        permanentlyUnavailable = true;
        return null;
      }
      const realtime = new AblyLib.Realtime({
        authCallback: (_params, cb) => {
          if (!tokenFetcher) {
            cb("ably_no_fetcher", null as unknown as string);
            return;
          }
          void tokenFetcher()
            .then((tr) => {
              if (!tr) {
                cb("ably_not_configured", null as unknown as string);
                return;
              }
              cb(null, tr);
            })
            .catch((err) => {
              const msg =
                err instanceof Error ? err.message : "ably_auth_failed";
              cb(msg, null as unknown as string);
            });
        },
      });
      client = realtime;
      return realtime;
    } catch {
      permanentlyUnavailable = true;
      client = null;
      return null;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}

/** @deprecated Prefer ensureSharedAblyClient + setAblyTokenFetcher. */
export function getSharedAblyClient(
  tokenRequest: AblyLib.TokenRequest | null | undefined,
): AblyLib.Realtime | null {
  if (permanentlyUnavailable || !tokenRequest) return null;
  if (client) return client;
  try {
    client = new AblyLib.Realtime({
      authCallback: (_params, cb) => {
        cb(null, tokenRequest);
      },
    });
    return client;
  } catch {
    permanentlyUnavailable = true;
    client = null;
    return null;
  }
}
