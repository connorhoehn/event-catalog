// tests/declarations-meeting.test.ts
//
// The `meeting` frames (realtime-modules src/meeting): every verb in
// MEETING_ACTIONS is declared, the schemas accept what useMeeting sends, and
// they refuse what MeetingService refuses on shape alone.

import { describe, it, expect, beforeAll } from 'vitest';
import { Registry } from '../src/registry/index.js';
import { clientMeetingDeclarations } from '../src/declarations/client-frames.js';
import { wsMeetingDeclarations, MEETING_ERROR_CODES } from '../src/declarations/gateway-signal.js';

// realtime-modules src/meeting/types.ts MEETING_ACTIONS / ORGANIZER_ACTIONS.
const MEETING_ACTIONS = [
  'subscribe', 'unsubscribe', 'hand.raise', 'hand.lower', 'hand.lowerAll',
  'breakout.configure', 'breakout.addRoom', 'breakout.rename', 'breakout.assign',
  'breakout.autoAssign', 'breakout.open', 'breakout.close', 'breakout.timer',
  'breakout.broadcast', 'breakout.join', 'breakout.leave', 'breakout.end',
];
const ORGANIZER_ACTIONS = new Set([
  'hand.lowerAll', 'breakout.configure', 'breakout.addRoom', 'breakout.rename',
  'breakout.assign', 'breakout.autoAssign', 'breakout.open', 'breakout.close',
  'breakout.timer', 'breakout.broadcast', 'breakout.end',
]);

let registry: Registry;
beforeAll(() => {
  registry = new Registry();
  for (const d of [...clientMeetingDeclarations, ...wsMeetingDeclarations]) registry.declare(d);
});

const ok = (name: string, payload: unknown) => registry.validate(name, payload).valid;
const frame = (action: string, extra: Record<string, unknown> = {}) =>
  ({ service: 'meeting', action, meetingId: 'call-42', ...extra });

describe('client.meeting.* — outbound', () => {
  it('declares exactly one frame per MEETING_ACTIONS verb', () => {
    expect(clientMeetingDeclarations.map((d) => d.name)).toEqual(MEETING_ACTIONS.map((a) => `client.meeting.${a}`));
  });

  it('marks the organizer-only verbs in the description and tags', () => {
    for (const d of clientMeetingDeclarations) {
      const action = d.name.slice('client.meeting.'.length);
      const organizerOnly = ORGANIZER_ACTIONS.has(action);
      expect(d.description!.startsWith('Organizer only.'), d.name).toBe(organizerOnly);
      expect(d.tags!.includes('organizer-only'), d.name).toBe(organizerOnly);
    }
    expect(clientMeetingDeclarations.find((d) => d.name === 'client.meeting.hand.lower')!.description).toMatch(/organizer only when userId names another user/);
  });

  it('accepts every frame useMeeting sends', () => {
    const sent: Array<[string, Record<string, unknown>]> = [
      ['subscribe', {}], ['unsubscribe', {}],
      ['hand.raise', {}], ['hand.raise', { displayName: 'Ada' }],
      ['hand.lower', {}], ['hand.lower', { userId: 'u-2' }], ['hand.lowerAll', {}],
      ['breakout.configure', { rooms: [{ name: 'Room 1' }, { id: 'r-2', name: 'Design', members: ['u-1'] }], mode: 'assigned', allowReturnToMain: false }],
      ['breakout.configure', { rooms: [] }],
      ['breakout.addRoom', {}], ['breakout.addRoom', { id: 'r_3', name: 'Ops' }],
      ['breakout.rename', { roomId: 'r-2', name: 'Research' }],
      ['breakout.assign', { assignments: { 'u-1': 'r-2', 'u-2': null } }],
      ['breakout.autoAssign', { userIds: ['u-1', 'u-2'] }],
      ['breakout.open', {}], ['breakout.open', { roomIds: ['r-2'] }],
      ['breakout.close', {}], ['breakout.close', { roomIds: ['r-2'], immediate: true }],
      ['breakout.timer', { durationMs: 600000 }], ['breakout.timer', { durationMs: null }],
      ['breakout.broadcast', { message: 'Two minutes left', displayName: 'Ada' }],
      ['breakout.join', { roomId: 'r-2' }], ['breakout.leave', {}],
      ['breakout.end', {}], ['breakout.end', { immediate: true }],
    ];
    for (const [action, extra] of sent) {
      expect(ok(`client.meeting.${action}`, frame(action, extra)), `${action} ${JSON.stringify(extra)}`).toBe(true);
    }
  });

  it('requires meetingId and enforces MEETING_ID_PATTERN plus the breakout separator ban', () => {
    expect(ok('client.meeting.subscribe', { service: 'meeting', action: 'subscribe' })).toBe(false);
    expect(ok('client.meeting.subscribe', frame('subscribe', { meetingId: '' }))).toBe(false);
    expect(ok('client.meeting.subscribe', frame('subscribe', { meetingId: 'a b' }))).toBe(false);
    expect(ok('client.meeting.subscribe', frame('subscribe', { meetingId: 'x'.repeat(201) }))).toBe(false);
    expect(ok('client.meeting.subscribe', frame('subscribe', { meetingId: 'call~breakout~r1' }))).toBe(false);
    expect(ok('client.meeting.subscribe', frame('subscribe', { meetingId: 'doc:abc_1.2~x-y' }))).toBe(true);
  });

  it('refuses the shapes MeetingService refuses', () => {
    expect(ok('client.meeting.breakout.configure', frame('breakout.configure'))).toBe(false);
    expect(ok('client.meeting.breakout.configure', frame('breakout.configure', { rooms: [{ id: 'bad id' }] }))).toBe(false);
    expect(ok('client.meeting.breakout.addRoom', frame('breakout.addRoom', { id: 'x'.repeat(65) }))).toBe(false);
    expect(ok('client.meeting.breakout.addRoom', frame('breakout.addRoom', { name: 'x'.repeat(81) }))).toBe(false);
    expect(ok('client.meeting.breakout.rename', frame('breakout.rename', { roomId: 'r-2' }))).toBe(false);
    expect(ok('client.meeting.breakout.assign', frame('breakout.assign', { assignments: { 'u-1': 7 } }))).toBe(false);
    expect(ok('client.meeting.breakout.broadcast', frame('breakout.broadcast', { message: '' }))).toBe(false);
    expect(ok('client.meeting.breakout.broadcast', frame('breakout.broadcast', { message: 'x'.repeat(501) }))).toBe(false);
    expect(ok('client.meeting.breakout.join', frame('breakout.join'))).toBe(false);
  });

  // realtime-modules 0.131.0: configure refuses these with INVALID_PAYLOAD.
  it('refuses the malformed configure fields MeetingService refuses since 0.131.0', () => {
    const configure = (extra: Record<string, unknown>) => ok('client.meeting.breakout.configure', frame('breakout.configure', { rooms: [], ...extra }));
    expect(configure({ mode: 'free-for-all' })).toBe(false);
    expect(configure({ allowReturnToMain: 'yes' })).toBe(false);
    expect(configure({ rooms: ['Room 1'] })).toBe(false);
    expect(configure({ rooms: [['r-1']] })).toBe(false);
    expect(configure({ rooms: [{ name: 7 }] })).toBe(false);
    expect(configure({ rooms: [{ members: 'u-1' }] })).toBe(false);
    expect(configure({ rooms: [{ members: ['u-1', 2] }] })).toBe(false);
  });

  it('accepts a null room name in configure (the server names it "Room N") and absent mode/settings', () => {
    expect(ok('client.meeting.breakout.configure', frame('breakout.configure', {
      rooms: [{ id: 'r-1', name: null, members: ['u-1'] }, { name: 'Design' }, {}],
    }))).toBe(true);
  });
});

describe('ws.meeting.* — inbound', () => {
  const ts = '2026-10-16T12:00:00.000Z';
  const breakout = {
    phase: 'open', mode: 'self-select',
    rooms: [{ id: 'r-1', name: 'Room 1', state: 'open', members: ['u-1'] }],
    returned: [], endsAt: '2026-10-16T12:10:00.000Z', closing: false,
    announcement: { message: 'Hi', fromUserId: 'u-0', fromDisplayName: 'Ada', at: ts },
    settings: { allowReturnToMain: true },
  };
  const hands = [{ userId: 'u-1', displayName: 'Bo', raisedAt: ts }];

  it('declares every MeetingServerFrame action', () => {
    expect(wsMeetingDeclarations.map((d) => d.name)).toEqual([
      'ws.meeting.meeting.snapshot', 'ws.meeting.hands.changed', 'ws.meeting.breakout.changed',
      'ws.meeting.breakout.announcement', 'ws.meeting.meeting.unsubscribed', 'ws.meeting.error',
    ]);
  });

  it('accepts the frames MeetingService sends', () => {
    const env = (action: string, data: unknown) => ({ type: 'meeting', action, meetingId: 'call-42', data, timestamp: ts });
    expect(ok('ws.meeting.meeting.snapshot', env('meeting.snapshot', {
      meetingId: 'call-42', createdBy: 'u-0', version: 3, hands, breakout, updatedAt: ts,
      you: { userId: 'u-1', organizer: false },
    }))).toBe(true);
    expect(ok('ws.meeting.meeting.snapshot', env('meeting.snapshot', {
      meetingId: 'call-42', createdBy: null, version: 0, hands: [],
      breakout: { phase: 'none', mode: 'self-select', rooms: [], returned: [], endsAt: null, announcement: null, settings: { allowReturnToMain: true } },
      updatedAt: ts, you: { userId: null, organizer: false },
    }))).toBe(true);
    expect(ok('ws.meeting.hands.changed', env('hands.changed', { version: 4, hands }))).toBe(true);
    expect(ok('ws.meeting.breakout.changed', env('breakout.changed', { version: 5, breakout }))).toBe(true);
    expect(ok('ws.meeting.breakout.announcement', env('breakout.announcement', breakout.announcement))).toBe(true);
    expect(ok('ws.meeting.meeting.unsubscribed', env('meeting.unsubscribed', {}))).toBe(true);
    for (const code of MEETING_ERROR_CODES) {
      expect(ok('ws.meeting.error', {
        type: 'meeting', action: 'error', meetingId: null,
        error: { code, message: 'nope', requestAction: 'breakout.bogus' }, timestamp: ts,
      }), code).toBe(true);
    }
  });

  it('carries the announcement history (0.130.0) and RATE_LIMITED (0.132.0)', () => {
    const env = (action: string, data: unknown) => ({ type: 'meeting', action, meetingId: 'call-42', data, timestamp: ts });
    const announcements = Array.from({ length: 20 }, (_, i) => ({ ...breakout.announcement, message: `Note ${i}` }));
    expect(ok('ws.meeting.breakout.changed', env('breakout.changed', { version: 6, breakout: { ...breakout, announcements } }))).toBe(true);
    expect(ok('ws.meeting.meeting.snapshot', env('meeting.snapshot', {
      meetingId: 'call-42', createdBy: 'u-0', version: 6, hands, breakout: { ...breakout, announcements: [] }, updatedAt: ts,
      you: { userId: 'u-1', organizer: true },
    }))).toBe(true);
    expect(ok('ws.meeting.breakout.changed', env('breakout.changed', {
      version: 6, breakout: { ...breakout, announcements: [...announcements, breakout.announcement] },
    }))).toBe(false);
    expect(ok('ws.meeting.breakout.changed', env('breakout.changed', {
      version: 6, breakout: { ...breakout, announcements: [{ message: 'no sender' }] },
    }))).toBe(false);
    expect(MEETING_ERROR_CODES[MEETING_ERROR_CODES.length - 1]).toBe('RATE_LIMITED');
    expect(MEETING_ERROR_CODES.indexOf('RATE_LIMITED')).toBe(MEETING_ERROR_CODES.indexOf('CONFLICT') + 1);
  });

  it('refuses an unknown error code and a malformed room', () => {
    expect(ok('ws.meeting.error', {
      type: 'meeting', action: 'error', meetingId: 'call-42',
      error: { code: 'TEAPOT', message: 'x', requestAction: 'hand.raise' }, timestamp: ts,
    })).toBe(false);
    expect(ok('ws.meeting.breakout.changed', {
      type: 'meeting', action: 'breakout.changed', meetingId: 'call-42', timestamp: ts,
      data: { version: 1, breakout: { ...breakout, rooms: [{ id: 'r-1', name: 'Room 1', state: 'ajar', members: [] }] } },
    })).toBe(false);
  });
});
