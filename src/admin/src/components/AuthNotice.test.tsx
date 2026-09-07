import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { AuthNotice } from './AuthNotice';
import { noteResponseStatus, resetAuthState } from '../auth';
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
    expect(notice).toHaveTextContent(/Reads are unaffected/i);
    expect(notice).toHaveTextContent(/proxy/i);
    // Announced, not just drawn: an operator who was refused a DLQ replay is
    // most likely looking at the row, not the top of the page.
    expect(notice).toHaveAttribute('role', 'alert');
  });

  it('offers no field to type a token into', () => {
    render(<AuthNotice />);
    act(() => noteResponseStatus(401));
    // It IS rendered — otherwise the two negatives below would pass vacuously.
    expect(screen.getByTestId('auth-notice')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    // …and no dismiss control. Nothing the operator can do here clears the
    // condition, and a closable banner is a forgotten one.
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });
});

describe('the notice is app-wide, not per-view', () => {
  it('survives a route change so the next view does not have to rediscover the 401', async () => {
    // The real regression this guards: an operator refused a bulk deprecate on
    // /events navigates to /dlq to try a replay instead, and is told nothing
    // until that fails too.
    mockFetch({
      ...realRoutes,
      '/api/health': { body: { status: 'healthy', redis: { status: 'connected' }, messageQueue: { status: 'connected' }, uptime: 1, eventCount: 2 } },
      '/api/health/registry': { body: { registrySize: 2, namespaceCount: 1, deprecatedCount: 0, orphanCount: 0, manifestCount: null, signal: { status: 'connected' }, durable: { status: 'connected' }, capturedAt: new Date().toISOString() } },
      '/api/metrics': { body: {} },
      '/api/deprecated': { body: { count: 0, items: [] } },
      '/api/events/poisoned': { body: { count: 0, items: [] } },
      '/api/transports/durable/dlq': { body: { messages: [], total: 0 } },
      '/api/subscribers': { body: { subscribers: [], total: 0 } },
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
