/**
 * The signed-in session kept in localStorage and its renewal. Access tokens live an hour: the
 * AuthProvider renews a minute before expiry, and any API request refused with 401 renews once and
 * is sent again (installSessionRenewal), so a tab left open keeps working. Renewals are shared:
 * the refresh token is single-use, so two renewals at once would sign the reader out.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";
const SESSION_KEY = "readai_session";

/** CustomEvent<StoredSession> on window after a renewal. */
export const SESSION_RENEWED = "readai:session-renewed";
/** Event on window when the session cannot be renewed any more (refresh token refused). */
export const SESSION_ENDED = "readai:session-ended";

export interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

const nativeFetch = window.fetch.bind(window);
let renewing: Promise<StoredSession | null> | null = null;
let installed = false;

export function readSession(): StoredSession | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

async function renew(): Promise<StoredSession | null> {
  const current = readSession();
  if (!current?.refresh_token) return null;
  try {
    const response = await nativeFetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: current.refresh_token }),
    });
    if (response.status === 400 || response.status === 401) {
      window.dispatchEvent(new Event(SESSION_ENDED));
      return null;
    }
    // Server trouble: keep the session, a later request or the timer tries again
    if (!response.ok) return null;
    const { session } = (await response.json()) as { session: StoredSession };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.dispatchEvent(new CustomEvent<StoredSession>(SESSION_RENEWED, { detail: session }));
    return session;
  } catch {
    // Offline: same as server trouble
    return null;
  }
}

/** Renew the stored session; callers at the same time share one renewal. null = not renewed. */
export function renewSession(): Promise<StoredSession | null> {
  if (!renewing) renewing = renew().finally(() => { renewing = null; });
  return renewing;
}

// Our API, whichever base a client was built with ('/api' or an absolute URL); not the auth routes
function isApiRequest(input: RequestInfo | URL) {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const { pathname } = new URL(raw, window.location?.href ?? "http://localhost");
  return pathname.startsWith("/api/") && !pathname.startsWith("/api/auth/");
}

/** Wrap fetch once: an API request refused with 401 renews the session and is sent again, once. */
export function installSessionRenewal() {
  if (installed) return;
  installed = true;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await nativeFetch(input, init);
    if (response.status !== 401 || input instanceof Request || !isApiRequest(input) || !readSession()) return response;

    const session = await renewSession();
    if (!session) return response;
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${session.access_token}`);
    return nativeFetch(input, { ...init, headers });
  };
}
