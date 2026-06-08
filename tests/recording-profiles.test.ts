import { describe, expect, it } from 'vitest';
import {
  InvalidRecordingProfileError,
  RECORDING_PROFILES,
  RECORDING_PROFILE_REGISTRY,
  RECORDING_PROFILE_REGISTRY_VERSION,
  isRecordingProfile,
  resolveRecordingProfile,
  validateRecordingProfile,
} from '../src/declarations/recording-profiles';

describe('RECORDING_PROFILES registry shape', () => {
  it('declares every profile id in the registry', () => {
    for (const id of RECORDING_PROFILES) {
      expect(RECORDING_PROFILE_REGISTRY[id]).toBeDefined();
      expect(RECORDING_PROFILE_REGISTRY[id].profile).toBe(id);
    }
  });

  it('registry version is a positive integer', () => {
    expect(Number.isInteger(RECORDING_PROFILE_REGISTRY_VERSION)).toBe(true);
    expect(RECORDING_PROFILE_REGISTRY_VERSION).toBeGreaterThan(0);
  });

  it("hangout profile composes per-peer and transcribes", () => {
    const p = RECORDING_PROFILE_REGISTRY.hangout;
    expect(p.composePerPeer).toBe(true);
    expect(p.transcribe).toBe(true);
  });

  it('broadcast profile is single-stream, no transcription, s3 destination', () => {
    const p = RECORDING_PROFILE_REGISTRY.broadcast;
    expect(p.composePerPeer).toBe(false);
    expect(p.transcribe).toBe(false);
    expect(p.destination).toBe('s3');
    expect(p.maxLegs).toBe(1);
  });

  it('dm profile composes per-peer but never transcribes by default', () => {
    const p = RECORDING_PROFILE_REGISTRY.dm;
    expect(p.composePerPeer).toBe(true);
    expect(p.transcribe).toBe(false);
    expect(p.retentionDays).toBeLessThan(RECORDING_PROFILE_REGISTRY.hangout.retentionDays);
  });

  it('none profile records nothing', () => {
    const p = RECORDING_PROFILE_REGISTRY.none;
    expect(p.composePerPeer).toBe(false);
    expect(p.transcribe).toBe(false);
    expect(p.maxLegs).toBe(0);
    expect(p.retentionDays).toBe(0);
  });
});

describe('isRecordingProfile', () => {
  it.each(RECORDING_PROFILES)('accepts %s', (id) => {
    expect(isRecordingProfile(id)).toBe(true);
  });

  it.each(['', 'HANGOUT', 'unknown', 'masterclass', null, undefined, 42, {}, []])(
    'rejects %s',
    (v) => {
      expect(isRecordingProfile(v as unknown)).toBe(false);
    },
  );
});

describe('validateRecordingProfile', () => {
  it('returns the profile when valid', () => {
    expect(validateRecordingProfile('hangout')).toBe('hangout');
  });

  it('throws InvalidRecordingProfileError on unknown strings', () => {
    expect(() => validateRecordingProfile('webinar')).toThrow(InvalidRecordingProfileError);
  });

  it('error carries the offending value', () => {
    try {
      validateRecordingProfile(42);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidRecordingProfileError);
      expect((e as InvalidRecordingProfileError).received).toBe(42);
    }
  });
});

describe('resolveRecordingProfile — explicit profile path', () => {
  it('returns the registry entry when recordingProfile is set', () => {
    expect(resolveRecordingProfile({ recordingProfile: 'hangout' })).toEqual(
      RECORDING_PROFILE_REGISTRY.hangout,
    );
  });

  it('null / undefined input → none profile', () => {
    expect(resolveRecordingProfile(null)).toEqual(RECORDING_PROFILE_REGISTRY.none);
    expect(resolveRecordingProfile(undefined)).toEqual(RECORDING_PROFILE_REGISTRY.none);
  });

  it('empty object → none profile', () => {
    expect(resolveRecordingProfile({})).toEqual(RECORDING_PROFILE_REGISTRY.none);
  });

  it('unknown profile string falls through to legacy synthesis branch', () => {
    // recordingProfile is set but not a valid id, AND no legacy flags
    // → falls through to `none` defensive default.
    const r = resolveRecordingProfile({ recordingProfile: 'masterclass' });
    expect(r.profile).toBe('none');
  });
});

describe('resolveRecordingProfile — legacy flag synthesis', () => {
  it('compose=true + transcribe=true → hangout', () => {
    expect(
      resolveRecordingProfile({ composePerPeer: true, transcribe: true }).profile,
    ).toBe('hangout');
  });

  it('compose=true + transcribe=false → dm', () => {
    expect(
      resolveRecordingProfile({ composePerPeer: true, transcribe: false }).profile,
    ).toBe('dm');
  });

  it('compose=false + transcribe=false + enabled=true → broadcast', () => {
    expect(
      resolveRecordingProfile({
        composePerPeer: false,
        transcribe: false,
        enabled: true,
      }).profile,
    ).toBe('broadcast');
  });

  it('enabled=false short-circuits to none', () => {
    expect(
      resolveRecordingProfile({
        composePerPeer: true,
        transcribe: true,
        enabled: false,
      }).profile,
    ).toBe('none');
  });

  it('explicit recordingProfile beats legacy flags', () => {
    const r = resolveRecordingProfile({
      recordingProfile: 'none',
      composePerPeer: true,
      transcribe: true,
    });
    expect(r.profile).toBe('none');
  });
});

describe('resolveRecordingProfile — overrides', () => {
  it('applies override when key is in overridable list', () => {
    const r = resolveRecordingProfile({
      recordingProfile: 'hangout',
      overrides: { transcribe: false },
    });
    expect(r.transcribe).toBe(false);
    expect(r.composePerPeer).toBe(true); // base preserved
  });

  it('silently drops overrides for non-overridable keys', () => {
    // 'hangout' overridable is ['transcribe', 'destination'] — maxLegs is locked.
    const r = resolveRecordingProfile({
      recordingProfile: 'hangout',
      overrides: { maxLegs: 999 },
    });
    expect(r.maxLegs).toBe(RECORDING_PROFILE_REGISTRY.hangout.maxLegs);
  });

  it('none profile rejects every override (overridable is empty)', () => {
    const r = resolveRecordingProfile({
      recordingProfile: 'none',
      overrides: { transcribe: true, composePerPeer: true },
    });
    expect(r.transcribe).toBe(false);
    expect(r.composePerPeer).toBe(false);
  });

  it('custom profile accepts overrides for all flag fields', () => {
    const r = resolveRecordingProfile({
      recordingProfile: 'custom',
      overrides: { composePerPeer: true, transcribe: true, retentionDays: 90 },
    });
    expect(r.composePerPeer).toBe(true);
    expect(r.transcribe).toBe(true);
    expect(r.retentionDays).toBe(90);
  });
});
