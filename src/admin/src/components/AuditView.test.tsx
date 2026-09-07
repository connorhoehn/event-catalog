// /audit — the Registry Changes feed, from the operator's side.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuditView } from './AuditView';
import { installMockEventSource, MockEventSource, renderWithRouter } from '../test/helpers';

const frame = (over: Record<string, unknown> = {}) => ({
  kind: 'event.declared',
  timestamp: '2026-09-07T11:22:33.456Z',
  eventName: 'call:caption:line',
  namespace: 'call',
  version: 3,
  serviceName: 'platform-api',
  ...over,
});

function emit(...frames: unknown[]) {
  act(() => {
    for (const f of frames) MockEventSource.latest.emit(f);
  });
}

const rows = () => screen.queryAllByRole('listitem');

beforeEach(() => {
  installMockEventSource();
});
afterEach(() => vi.unstubAllGlobals());

describe('AuditView — the waiting state', () => {
  it('says it is waiting, and does not claim the registry is empty', () => {
    renderWithRouter(<AuditView />);
    expect(screen.getByRole('heading', { name: 'Registry Changes' })).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the next registry mutation/)).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
  });

  it('reports a dropped SSE connection instead of looking idle', () => {
    // A closed stream and a quiet registry look identical otherwise, and only
    // one of them means "you are not seeing changes that are happening".
    renderWithRouter(<AuditView />);
    act(() => MockEventSource.latest.fail());
    // The Banner is a status region too, so match on the one that carries it.
    expect(
      screen.getAllByRole('status').some((el) => el.textContent?.includes('SSE connection closed')),
    ).toBe(true);
  });

  it('shows the stream as live', () => {
    renderWithRouter(<AuditView />);
    expect(screen.getByText('live')).toBeInTheDocument();
    expect(screen.getByText('0 events')).toBeInTheDocument();
  });
});

describe('AuditView — rendering rows', () => {
  it('renders the newest change first', () => {
    renderWithRouter(<AuditView />);
    emit(frame({ eventName: 'a:one' }), frame({ eventName: 'a:two' }));
    expect(rows().map((li) => within(li).getByRole('link').textContent)).toEqual(['a:two', 'a:one']);
  });

  it('shows the kind, namespace, version and author of a change', () => {
    renderWithRouter(<AuditView />);
    emit(frame({ kind: 'event.version.bumped' }));
    const row = rows()[0]!;
    expect(within(row).getByText('version bump')).toBeInTheDocument();
    expect(within(row).getByText('call')).toBeInTheDocument();
    expect(within(row).getByText('v3')).toBeInTheDocument();
    expect(within(row).getByText('by platform-api')).toBeInTheDocument();
  });

  it('links each row to that event, encoding the colons in its name', () => {
    renderWithRouter(<AuditView />);
    emit(frame());
    expect(screen.getByRole('link', { name: 'call:caption:line' })).toHaveAttribute(
      'href',
      '/events/call%3Acaption%3Aline',
    );
  });

  it('flags compatibility warnings that came with a declaration', () => {
    renderWithRouter(<AuditView />);
    emit(frame({ violations: ['removed required field: id', 'narrowed type of ts'] }));
    expect(screen.getByText('2 compat warn')).toBeInTheDocument();
  });

  it('keeps rendering after a frame of an unknown kind arrives', () => {
    // A newer server emitting a sixth kind used to throw inside the row
    // renderer and blank the entire view.
    renderWithRouter(<AuditView />);
    emit(frame({ kind: 'event.fingerprint.changed', eventName: 'from:future' }), frame({ eventName: 'a:known' }));
    expect(screen.getByRole('link', { name: 'a:known' })).toBeInTheDocument();
    expect(rows()).toHaveLength(1);
  });

  it('counts the buffered changes', () => {
    renderWithRouter(<AuditView />);
    emit(frame({ eventName: 'a:one' }), frame({ eventName: 'a:two' }));
    expect(screen.getByText('2 events')).toBeInTheDocument();
  });
});

describe('AuditView — filters', () => {
  it('offers the namespaces it has actually seen', async () => {
    renderWithRouter(<AuditView />);
    emit(frame({ namespace: 'pipeline' }), frame({ namespace: 'call' }));
    const select = screen.getByLabelText('namespace') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'call', 'pipeline']);
  });

  it('asks the server to filter by kind', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AuditView />);
    await user.selectOptions(screen.getByLabelText('kind'), 'event.removed');
    expect(MockEventSource.latest.url).toContain('kind=event.removed');
  });

  it('DROPS rows from the namespace you just filtered away', async () => {
    // The bug: filtering is server-side, so a filter change reconnects — but
    // the already-buffered rows stayed on screen. Selecting "ws" left every
    // pipeline row visible under a toolbar that said the view was scoped to
    // ws.
    const user = userEvent.setup();
    renderWithRouter(<AuditView />);
    emit(frame({ namespace: 'pipeline', eventName: 'pipeline:step:started' }));
    emit(frame({ namespace: 'ws', eventName: 'ws:frame:sent' }));
    expect(rows()).toHaveLength(2);

    await user.selectOptions(screen.getByLabelText('namespace'), 'ws');
    expect(screen.queryByRole('link', { name: 'pipeline:step:started' })).not.toBeInTheDocument();
    expect(screen.getByText(/Waiting for the next registry mutation/)).toBeInTheDocument();

    emit(frame({ namespace: 'ws', eventName: 'ws:frame:sent' }));
    expect(rows()).toHaveLength(1);
  });
});

describe('AuditView — pause, resume, clear', () => {
  it('pauses the stream and says so', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AuditView />);
    const stream = MockEventSource.latest;
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(stream.closed).toBe(true);
    expect(screen.getByText('paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('keeps the rows it already has while paused', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AuditView />);
    emit(frame());
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(rows()).toHaveLength(1);
  });

  it('empties the feed on Clear', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AuditView />);
    emit(frame());
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(rows()).toHaveLength(0);
    expect(screen.getByText(/Waiting for the next registry mutation/)).toBeInTheDocument();
  });
});
