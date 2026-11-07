import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App } from '../App';
import { AuthNotice } from './AuthNotice';
import { isAuthRequired, noteResponseStatus, resetAuthState } from '../auth';
import { mockFetch } from '../test/helpers';
import { realRoutes } from '../test/fixtures/registry';

afterEach(() => {
  resetAuthState();
  vi.unstubAllGlobals();
});

describe('AuthNotice', () => {
  it('is invisible on an unauthenticated catalog — the default deployment', () => {
    render(<AuthNotice />);
    expect(screen.queryByTestId('auth-notice')).not.toBeInTheDocument();
  });

  it('appears the moment any call is answered 401, and explains itself', () => {
    render(<AuthNotice />);
    act(() => noteResponseStatus(401));
    const notice = screen.getByTestId('auth-notice');
    expect(notice).toHaveTextContent(/requires an API token/i);
    expect(notice).toHaveTextContent(/refused until you sign in/i);
    expect(notice).toHaveAttribute('role', 'alert');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });

  it('prompts for the token once, posts it to /admin/login, and carries on when accepted', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 204 }) as Response);
    vi.stubGlobal('fetch', fetchFn);
    const onSignedIn = vi.fn();
    render(<AuthNotice onSignedIn={onSignedIn} />);
    act(() => noteResponseStatus(401));

    const field = screen.getByLabelText('Catalog token');
    expect(field).toHaveAttribute('type', 'password');
    await userEvent.type(field, 'the-token-the-token-1234');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/admin/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ token: 'the-token-the-token-1234' });
    expect(isAuthRequired()).toBe(false);
  });

  it('keeps the prompt and says so when the token is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 }) as Response));
    const onSignedIn = vi.fn();
    render(<AuthNotice onSignedIn={onSignedIn} />);
    act(() => noteResponseStatus(401));
    await userEvent.type(screen.getByLabelText('Catalog token'), 'wrong-token-wrong-token');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText(/not accepted/i)).toBeInTheDocument());
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.getByTestId('auth-notice')).toBeInTheDocument();
    expect(screen.getByLabelText('Catalog token')).toHaveValue('');
  });
});

describe('the notice is app-wide, not per-view', () => {
  it('survives a route change so the next view does not have to rediscover the 401', async () => {
    // The real regression this guards: an operator refused a bulk deprecate on
    // /events navigates to /dlq to try a replay instead, and is told nothing
    // until that fails too.
    mockFetch({
      ...realRoutes,
      '/admin-api/health': { body: { status: 'healthy', redis: { status: 'connected' }, messageQueue: { status: 'connected' }, uptime: 1, eventCount: 2 } },
      '/admin-api/health/registry': { body: { registrySize: 2, namespaceCount: 1, deprecatedCount: 0, orphanCount: 0, manifestCount: null, signal: { status: 'connected' }, durable: { status: 'connected' }, capturedAt: new Date().toISOString() } },
      '/admin-api/metrics': { body: {} },
      '/admin-api/deprecated': { body: { count: 0, items: [] } },
      '/admin-api/events/poisoned': { body: { count: 0, items: [] } },
      '/admin-api/transports/durable/dlq': { body: { messages: [], total: 0 } },
      '/admin-api/subscribers': { body: { subscribers: [], total: 0 } },
      '/health': { body: { service: 'event-catalog', version: '0', status: 'healthy', checks: [], timestamp: '' } },
    });

    render(
      <MemoryRouter initialEntries={['/events']}>
        <App />
      </MemoryRouter>,
    );

    act(() => noteResponseStatus(401));
    await waitFor(() => expect(screen.getByTestId('auth-notice')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('link', { name: 'DLQ' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Dead-Letter Queue' })).toBeInTheDocument(),
    );
    expect(screen.getByTestId('auth-notice')).toBeInTheDocument();
  });
});
