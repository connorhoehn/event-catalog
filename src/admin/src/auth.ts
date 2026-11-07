// The admin UI's whole position on credentials.
//
// The server has a shared-secret bearer gate (`EVENT_CATALOG_AUTH_TOKEN`,
// src/server/auth.ts). It is required in production and whenever the
// message-queue secret is set, and when it is on it challenges every `/api`
// request — reads, the SSE streams and the dead-letter list included; only
// the health route and the static bundle stay open. So a catalog with the
// token set, reached without a proxy that adds it, loads its shell and then
// answers every data call with a bare 401.
//
// ─── The decision: the page never holds the token ───────────────────────────
//
// The token is a deployment-wide shared secret, and nowhere in a page is a
// safe place for it: localStorage is readable by any script on the origin
// (the admin renders schemas and DLQ errors other services wrote), a URL
// lands in history and logs, and an EventSource cannot set headers at all.
//
// So the operator pastes it ONCE into the sign-in prompt (`AuthNotice`). The
// server compares it in constant time and answers with an httpOnly,
// SameSite=Strict session cookie (12 hours, kept in server memory), and this
// UI calls `/admin-api/*`, which the server forwards to `/api/*` with the
// bearer attached server-side only for a request carrying that cookie
// (src/server/admin-session.ts). After the POST the token is gone from the
// page; nothing here stores or can read it. A deployment that prefers an
// authenticating reverse proxy in front still works: it injects the header
// itself and the prompt never appears.

import { useSyncExternalStore } from 'react';

/**
 * What a rejected call says in the place the component already renders
 * `err.message`. One sentence; the sign-in prompt above carries the rest.
 */
export const AUTH_REQUIRED_MESSAGE =
  'This catalog requires an API token — the server refused this action with '
  + '401 Unauthorized. Sign in with the token using the prompt at the top of the page.';

/** Heading for the app-wide sign-in prompt. */
export const AUTH_BANNER_TITLE = 'This catalog requires an API token.';

/** The prompt's explanation: what is blocked, and what signing in does. */
export const AUTH_BANNER_BODY =
  'Reads and changes are refused until you sign in: browsing, topology, the '
  + 'live flow, the dead-letter list and every change (declare, deprecate, '
  + 'subscriber add/remove, DLQ replay and clear). Paste the value of '
  + 'EVENT_CATALOG_AUTH_TOKEN once; the server keeps it and gives this browser '
  + 'a 12 hour session cookie, so the token is never stored in the page.';

/**
 * Latched, app-wide "the server is challenging our writes" flag.
 *
 * Latched rather than per-request because the fact is about the deployment,
 * not about the click: once one 401 has been seen, every other mutating
 * control on every other view is equally dead, and an operator should be told
 * that before they try the next one. `reset()` exists for tests — nothing in
 * the UI clears it, because nothing in the UI can make the server stop
 * requiring a token.
 */
let authRequired = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** Called by `api.ts` for every response it sees. */
export function noteResponseStatus(status: number): void {
  if (status !== 401 || authRequired) return;
  authRequired = true;
  emit();
}

export function isAuthRequired(): boolean {
  return authRequired;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Re-renders the subscriber the first time any call is challenged. */
export function useAuthRequired(): boolean {
  return useSyncExternalStore(subscribe, isAuthRequired, isAuthRequired);
}

/** Test-only. Puts the module back to its boot state. */
export function resetAuthState(): void {
  authRequired = false;
  emit();
}
