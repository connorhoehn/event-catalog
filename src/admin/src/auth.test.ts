// The UI's position on credentials, asserted rather than left in a comment.
//
// The decision (see the header of `auth.ts`) is that this UI holds no token:
// the server's `EVENT_CATALOG_AUTH_TOKEN` is a deployment-wide shared secret
// with no per-operator identity and no revocation, and every place a browser
// could put it — localStorage, a URL, an in-memory field behind a paste box —
// widens its blast radius without buying anything a proxy does not already
// give. What we owe the operator instead is a legible failure. These tests
// pin both halves: the latch that makes the failure app-wide, and the fact
// that no storage API is ever touched.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_BANNER_BODY,
  AUTH_BANNER_TITLE,
  AUTH_REQUIRED_MESSAGE,
  isAuthRequired,
  noteResponseStatus,
  resetAuthState,
} from './auth';

afterEach(() => {
  resetAuthState();
  vi.unstubAllGlobals();
});

describe('the auth-required latch', () => {
  it('starts off — the catalog ships unauthenticated and must look it', () => {
    expect(isAuthRequired()).toBe(false);
  });

  it('flips on the first 401 and stays on', () => {
    noteResponseStatus(200);
    expect(isAuthRequired()).toBe(false);
    noteResponseStatus(401);
    expect(isAuthRequired()).toBe(true);
    // A later 200 must NOT clear it: a 200 from the open health route says
    // nothing about whether the next data call will be refused.
    noteResponseStatus(200);
    expect(isAuthRequired()).toBe(true);
  });

  it.each([400, 403, 404, 409, 500, 503])('is not tripped by a %d', (status) => {
    // 403 in particular: a proxy that authenticated us and then refused the
    // action is a different problem, and telling the operator to go configure
    // a token would send them the wrong way.
    noteResponseStatus(status);
    expect(isAuthRequired()).toBe(false);
  });
});

describe('what the operator is told', () => {
  it('names the condition, not the status line, in the inline message', () => {
    expect(AUTH_REQUIRED_MESSAGE).toMatch(/requires an API token/i);
    expect(AUTH_REQUIRED_MESSAGE).toMatch(/401/);
    // The thing a bare `API 401: {"error":"Unauthorized"}` never said.
    expect(AUTH_REQUIRED_MESSAGE).toMatch(/holds no credentials/i);
  });

  it('tells the operator which actions are dead and which are not', () => {
    expect(AUTH_BANNER_TITLE).toMatch(/requires an API token/i);
    expect(AUTH_BANNER_BODY).toMatch(/Reads and changes are both refused/i);
    for (const action of ['declare', 'deprecate', 'subscriber', 'replay']) {
      expect(AUTH_BANNER_BODY.toLowerCase()).toContain(action);
    }
  });

  it('gives two ways out, and neither is "paste it here"', () => {
    expect(AUTH_BANNER_BODY).toMatch(/proxy/i);
    expect(AUTH_BANNER_BODY).toMatch(/EVENT_CATALOG_AUTH_TOKEN/);
    expect(AUTH_BANNER_BODY).toMatch(/Authorization: Bearer/);
  });
});

describe('the module stores nothing', () => {
  it('never reads or writes browser storage', async () => {
    // The load-bearing assertion behind the decision. If someone later adds a
    // token field backed by localStorage, this fails — which is the point:
    // a secret that outlives the tab is a secret in a place we cannot revoke.
    const localSet = vi.spyOn(Storage.prototype, 'setItem');
    const localGet = vi.spyOn(Storage.prototype, 'getItem');

    const mod = await import('./auth');
    mod.noteResponseStatus(401);
    expect(mod.isAuthRequired()).toBe(true);

    expect(localSet).not.toHaveBeenCalled();
    expect(localGet).not.toHaveBeenCalled();
    localSet.mockRestore();
    localGet.mockRestore();
  });

  it('exports no way to supply a token', async () => {
    const mod = await import('./auth');
    const surface = Object.keys(mod).join(' ').toLowerCase();
    for (const forbidden of ['settoken', 'storetoken', 'savetoken', 'gettoken']) {
      expect(surface).not.toContain(forbidden);
    }
  });
});
