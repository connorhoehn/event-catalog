// src/declarations/recording-profiles.ts
//
// Channel recording profile registry — single source of truth for what
// {composePerPeer, transcribe, retention, destination, maxLegs} mean
// when a channel says `recordingProfile: 'hangout'` (etc).
//
// Consumed by:
//   - live-video-streaming/src/services/channelStore.js
//     (validates incoming profile id, resolves on read)
//   - live-video-streaming/src/recording/RecordingManager.js
//     (reads resolved profile to gate per-peer recording + transcription)
//   - platform-api/src/routes/videoSessions.ts
//     (accepts recordingProfile in request body; validates)
//   - platform-api/src/routes/lvsWebhooks.ts
//     (reads recordingProfile on incoming recording.completed)
//   - websocket-gateway/frontend/src/hooks/useVideoCall.ts
//     (FE call-site startCall({ recordingProfile }))
//
// Adding a 6th profile: append to RECORDING_PROFILES, add an entry to
// RECORDING_PROFILE_REGISTRY. That's it — every consumer auto-picks it
// up at the next SHA bump. No switch statements; resolution is data,
// not code.
//
// See live-video-streaming/.agent/ADR-002-recording-profiles.md for
// the design rationale.

/**
 * Canonical recording profile identifiers.
 *
 * `custom` is the escape hatch when a channel has flag overrides that
 * don't match any first-class profile. New code should not write
 * `custom`; it exists for the read-time legacy-flag synthesis path
 * and as a safe fallback for unrecognized profiles in older rows.
 */
export const RECORDING_PROFILES = [
  'hangout',
  'broadcast',
  'dm',
  'none',
  'custom',
] as const;

export type RecordingProfile = (typeof RECORDING_PROFILES)[number];

/**
 * Resolved recording configuration. Every field has a concrete value
 * — consumers should never see `undefined` after `resolveRecordingProfile`.
 *
 * `overridable` is metadata, not config: it declares which fields
 * tolerate a per-channel override. Out-of-band overrides for fields
 * not in this list are silently dropped on resolve.
 */
export interface RecordingProfileDef {
  profile: RecordingProfile;
  composePerPeer: boolean;
  transcribe: boolean;
  retentionDays: number;
  destination: 'local' | 's3' | 'gcs' | 'azure';
  maxLegs: number;
  overridable: ReadonlyArray<
    'composePerPeer' | 'transcribe' | 'retentionDays' | 'destination' | 'maxLegs'
  >;
}

/**
 * Profile → materialized config table. Edit-and-ship is the extension
 * model — adding a profile is one entry here + bumping the SHA pin in
 * each consumer.
 */
export const RECORDING_PROFILE_REGISTRY: Readonly<
  Record<RecordingProfile, RecordingProfileDef>
> = {
  hangout: {
    profile: 'hangout',
    composePerPeer: true,
    transcribe: true,
    retentionDays: 30,
    destination: 'local',
    maxLegs: 12,
    overridable: ['transcribe', 'destination'],
  },
  broadcast: {
    profile: 'broadcast',
    composePerPeer: false,
    transcribe: false,
    retentionDays: 365,
    destination: 's3',
    maxLegs: 1,
    overridable: ['retentionDays'],
  },
  dm: {
    profile: 'dm',
    composePerPeer: true,
    transcribe: false,
    retentionDays: 7,
    destination: 'local',
    maxLegs: 2,
    overridable: ['transcribe'],
  },
  none: {
    profile: 'none',
    composePerPeer: false,
    transcribe: false,
    retentionDays: 0,
    destination: 'local',
    maxLegs: 0,
    overridable: [],
  },
  custom: {
    profile: 'custom',
    composePerPeer: false,
    transcribe: false,
    retentionDays: 30,
    destination: 'local',
    maxLegs: 4,
    overridable: [
      'composePerPeer',
      'transcribe',
      'retentionDays',
      'destination',
      'maxLegs',
    ],
  },
};

/**
 * Registry version. Bump when a profile's resolved semantics change
 * (e.g., `hangout.retentionDays` 30 → 60). Recording rows snapshot
 * this value as `profileVersion` at recording-start so in-flight
 * recordings finalize under the version they began with, even after
 * the registry advances.
 */
export const RECORDING_PROFILE_REGISTRY_VERSION = 1;

/**
 * Strict type-guard. Use at every cross-repo boundary (HTTP body
 * parser, webhook consumer, MQ envelope reader) before trusting the
 * value as a `RecordingProfile`.
 */
export function isRecordingProfile(s: unknown): s is RecordingProfile {
  return (
    typeof s === 'string' &&
    (RECORDING_PROFILES as readonly string[]).includes(s)
  );
}

/**
 * Throwing variant for use in API route handlers where an invalid
 * profile string should produce a 400.
 */
export class InvalidRecordingProfileError extends Error {
  readonly received: unknown;
  constructor(received: unknown) {
    super(
      `invalid recordingProfile: ${typeof received === 'string' ? `'${received}'` : String(received)} ` +
        `(valid: ${RECORDING_PROFILES.join(', ')})`,
    );
    this.name = 'InvalidRecordingProfileError';
    this.received = received;
  }
}

export function validateRecordingProfile(s: unknown): RecordingProfile {
  if (isRecordingProfile(s)) return s;
  throw new InvalidRecordingProfileError(s);
}

/**
 * Input to `resolveRecordingProfile` — accepts the new canonical
 * `recordingProfile` field AND the legacy flag pair so callers can
 * pass raw channel rows from before the migration.
 */
export interface StoredRecordingConfig {
  recordingProfile?: RecordingProfile | string;
  overrides?: Partial<RecordingProfileDef>;
  // Legacy fields — accepted on the read path only. Write path should
  // emit `recordingProfile` + `overrides`.
  composePerPeer?: boolean;
  transcribe?: boolean;
  enabled?: boolean;
}

/**
 * Map a legacy flag-tuple to a synthesized profile. Used only when
 * `stored.recordingProfile` is absent — never overwrites an explicit
 * profile selection.
 */
function synthesizeFromLegacyFlags(
  stored: StoredRecordingConfig,
): RecordingProfileDef {
  // `enabled: false` short-circuits — recording is off regardless of
  // other flags.
  if (stored.enabled === false) {
    return RECORDING_PROFILE_REGISTRY.none;
  }
  const compose = stored.composePerPeer === true;
  const transcribe = stored.transcribe === true;
  if (compose && transcribe) return RECORDING_PROFILE_REGISTRY.hangout;
  if (compose && !transcribe) return RECORDING_PROFILE_REGISTRY.dm;
  if (!compose && !transcribe) {
    return RECORDING_PROFILE_REGISTRY.broadcast;
  }
  // Unreachable in practice — every combo is mapped above. Return
  // `custom` as a defensive fallback carrying the original flags as
  // overrides so the recorder still sees something sane.
  return {
    ...RECORDING_PROFILE_REGISTRY.custom,
    composePerPeer: compose,
    transcribe,
  };
}

/**
 * Resolve a stored config (which may carry a profile id, a legacy
 * flag tuple, or both) into a fully materialized `RecordingProfileDef`.
 *
 * Precedence:
 *   1. `stored.recordingProfile` (validated; falls through to legacy
 *      synthesis if the string is unknown)
 *   2. Legacy `composePerPeer` + `transcribe` flags
 *   3. `'none'` as a final defensive default
 *
 * Overrides:
 *   When `stored.overrides` is present, each overridable field in the
 *   base profile is replaced by the override value. Fields not in the
 *   base profile's `overridable` list are silently dropped.
 */
export function resolveRecordingProfile(
  stored: StoredRecordingConfig | null | undefined,
): RecordingProfileDef {
  if (!stored) return RECORDING_PROFILE_REGISTRY.none;

  let base: RecordingProfileDef;
  if (typeof stored.recordingProfile === 'string' && isRecordingProfile(stored.recordingProfile)) {
    base = RECORDING_PROFILE_REGISTRY[stored.recordingProfile];
  } else if (
    stored.composePerPeer !== undefined ||
    stored.transcribe !== undefined ||
    stored.enabled === false
  ) {
    base = synthesizeFromLegacyFlags(stored);
  } else {
    base = RECORDING_PROFILE_REGISTRY.none;
  }

  if (!stored.overrides) return base;

  const merged: RecordingProfileDef = { ...base };
  for (const key of base.overridable) {
    const v = stored.overrides[key];
    if (v !== undefined) {
      (merged as unknown as Record<string, unknown>)[key] = v;
    }
  }
  return merged;
}
