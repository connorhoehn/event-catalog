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
// ─── The decision: this UI holds no token ───────────────────────────────────
//
// It would be a handful of lines to add a "paste your token" field. We do not,
// for four reasons, in descending order of how much they matter:
//
//  1. **It is a deployment-wide shared secret, not a user credential.** There
//     is no login, no per-operator identity, no scope and no rotation story —
//     `resolveAuthToken` validates one string and `secretsMatch` compares
//     against it. Anyone holding it can delete every declaration and clear the
//     DLQ. Asking an operator to paste that into a browser field multiplies
//     the number of places it exists: clipboard history, password-manager
//     autofill, a screen share, a devtools Network panel, a browser extension
//     with host permissions.
//
//  2. **Nowhere to put it is actually safe.** `localStorage` survives the tab
//     and is readable by any script that ever executes on this origin — the
//     admin renders event names, producers, schemas and DLQ error strings that
//     come from other services, so an XSS here is not hypothetical. In-memory
//     state avoids the disk but is lost on every refresh, which makes it
//     useless in the one workflow (a long DLQ redrive session) that would want
//     it. A URL or query parameter is worse still: it lands in browser
//     history, in the Referer header of every outbound link, and in the
//     access log of anything in front of us.
//
//  3. **The server already names the right answer.** The 401 carries
//     `WWW-Authenticate: Bearer`, and the token is meant for machine callers —
//     the producers that POST their declarations at boot via
//     `syncToRemoteRegistry`. A human operating the admin UI belongs behind an
//     authenticating reverse proxy that terminates SSO and injects
//     `Authorization: Bearer $EVENT_CATALOG_AUTH_TOKEN` upstream. That gives
//     per-person identity and revocation, which a pasted shared secret cannot.
//
//  4. **The proxy is the only place it scales.** Reads and writes are both
//     challenged, so a token in the page would have to ride on every fetch
//     and every EventSource (which cannot set headers at all); a proxy adds
//     it to all of them in one place.
//
// What we owe the operator instead is that the failure is legible: the exact
// action that was refused, why, and what to do about it — never a bare
// "API 401: {"error":"Unauthorized"}".

import { useSyncExternalStore } from 'react';

/**
 * What a mutating call's rejection says in the place the component already
 * renders `err.message`. One sentence: the components put it in an inline
 * error next to the control that failed, and the banner below carries the
 * long form.
 */
export const AUTH_REQUIRED_MESSAGE =
  'This catalog requires an API token — the server refused this action with '
  + '401 Unauthorized. The admin UI holds no credentials by design; reach it '
  + 'through a proxy that adds the Authorization header.';

/** Heading for the app-wide banner. */
export const AUTH_BANNER_TITLE = 'This catalog requires an API token.';

/**
 * The long form, shown once at the top of the app rather than repeated at
 * every control. Kept as data so a test can assert the operator is told the
 * three things they need: what still works, what does not, and the fix.
 */
export const AUTH_BANNER_BODY =
  'Reads and changes are both refused — browsing, topology, the live flow, '
  + 'the dead-letter list and every change (declare, deprecate, subscriber '
  + 'add/remove, DLQ replay and clear) will keep failing with 401 until the request carries '
  + '`Authorization: Bearer <token>`. This UI deliberately stores no token: '
  + 'the value in EVENT_CATALOG_AUTH_TOKEN is a deployment-wide shared secret '
  + 'with no per-operator identity or revocation, so it belongs in an '
  + 'authenticating proxy in front of the catalog, not in a browser. Only a '
  + 'local development catalog runs without EVENT_CATALOG_AUTH_TOKEN.';

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
