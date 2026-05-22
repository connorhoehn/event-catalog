# ec-bundle-create

Scaffolds a new FeatureBundle file from a template and registers it in `src/declarations/bundles/index.ts`. Eliminates the boilerplate of wiring a new bundle by hand.

## Usage

```
ec-bundle-create <name> [options]
ec-bundle-create --help
```

| Argument | Description |
|---|---|
| `<name>` | Bundle name in kebab-case (e.g. `video-reactions`) |
| `--version <semver>` | Initial version string (default: `1.0.0`) |
| `--transport <mode>` | `signal`, `durable`, or `both` (default: `signal`) |
| `--events <list>` | Comma-separated event names to pre-populate |
| `--help`, `-h` | Show help |

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Bundle file created and `index.ts` updated |
| `1` | Bundle file already exists, or `index.ts` could not be updated |
| `2` | Usage error (missing name, invalid name, bad transport/version) |

## Examples

```sh
# Minimal — defaults to signal transport, version 1.0.0
ec-bundle-create video-reactions

# Durable transport with explicit version
ec-bundle-create live-poll --transport durable --version 2.0.0

# Pre-populate event references
ec-bundle-create screenshare --events ws.screen.started,ws.screen.stopped

# All options
ec-bundle-create presence-v2 --version 2.0.0 --transport both \
  --events ws.presence.joined,ws.presence.left,ws.presence.heartbeat
```

## Generated Output

Running `ec-bundle-create video-reactions --events ws.video.started,ws.video.stopped` produces:

**`src/declarations/bundles/video-reactions.ts`**
```typescript
// src/declarations/bundles/video-reactions.ts
//
// "video-reactions" FeatureBundle — auto-scaffolded by ec-bundle-create.
// Update the description and event list to match your feature.

import { computeFingerprint, type FeatureBundle } from '../../bundles/FeatureBundle.js';

const _def: Omit<FeatureBundle, 'fingerprint'> = {
  name: 'video-reactions',
  version: '1.0.0',
  transport: 'signal',
  description: 'Auto-scaffolded by ec-bundle-create. Update this description.',
  events: [
    { name: 'ws.video.started', required: true },
    { name: 'ws.video.stopped', required: true },
  ],
};

export const videoReactionsBundle: FeatureBundle = {
  ..._def,
  fingerprint: computeFingerprint(_def),
};
```

**`src/declarations/bundles/index.ts`** is updated with:
- A named re-export for `videoReactionsBundle`
- An import statement
- An entry in the `allBundles` array

## Workflow

```
create → edit → test → commit → bump → tag
```

1. **Create** — run `ec-bundle-create <name>` to scaffold the file and update the index.
2. **Edit** — open the generated file and:
   - Replace the placeholder description.
   - Add or adjust event references (`required: true` vs `required: false`).
   - Set the correct `transport` if you did not use `--transport`.
3. **Test** — run `npm test` to verify the bundle registers correctly and all existing tests pass.
4. **Commit** — commit both the new bundle file and the updated `index.ts`.
5. **Bump** — increment the package version in `package.json` (patch for additive changes).
6. **Tag** — create a git tag matching the new version: `git tag v0.x.y && git push --tags`.

## Naming Conventions

| Rule | Example |
|---|---|
| Kebab-case, all lowercase | `video-reactions`, `live-poll` |
| Descriptive of the capability, not the implementation | `screenshare` not `webrtc-stream` |
| No version suffix in the name | `presence` not `presence-v2` |
| No `.ts` extension | `chat` not `chat.ts` |
| Must start with a letter | `chat` not `2-chat` |

The bundle name becomes the export identifier by camelCase conversion:
`video-reactions` → `videoReactionsBundle`.

## Editing the Generated File

After scaffolding, the key fields to update are:

- **`description`** — Replace the placeholder with a one-line capability description.
- **`events`** — Each entry is `{ name: '<event-name>', required: true | false }`.
  - `required: true` (or omitted) — the event MUST be registered; validation fails if absent.
  - `required: false` — optional; lightweight consumers may omit it.
- **`transport`** — Must match the aggregate transport of the listed events:
  - `'signal'` — all events are WebSocket (ws.*).
  - `'durable'` — all events go through the durable message queue.
  - `'both'` — mixed signal and durable events.

## Relationship to ec-bundle-diff

After bumping a bundle version manually, use `ec-bundle-diff` to verify the suggested semver bump matches the actual event set changes:

```sh
ec-bundle-diff video-reactions@1.0.0 video-reactions@1.1.0
```

See [docs/cli/bundle-diff.md](./bundle-diff.md) for details.
