# ec-bundle-diff

Compares two versions of a FeatureBundle and reports event set changes, including a suggested semver bump.

## Usage

```
ec-bundle-diff <name>@<v1> <name>@<v2>
ec-bundle-diff --help
```

| Argument | Description |
|---|---|
| `<name>@<v1>` | First bundle reference (e.g. `chat@1.0.0`) |
| `<name>@<v2>` | Second bundle reference (e.g. `chat@2.0.0`) |
| `--help`, `-h` | Show help |

Both arguments must reference the same bundle name.

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Diff completed successfully (including "no changes") |
| `1` | One or both bundle versions not found in the catalog |
| `2` | Usage error (wrong arguments, mismatched bundle names) |

## Example Output

```
Bundle: chat
Versions: 1.0.0 → 2.0.0

Added (required):
  + ws.chat.message.threaded

Added (optional):
  + ws.chat.typing

Removed:
  - ws.chat.message.legacy

Required-to-optional:
  ~ ws.chat.member.left (was required, now optional)

Optional-to-required:
  ~ ws.chat.member.joined (was optional, now required) — BREAKING

Fingerprint: abc123456789 → def456789abc
Suggested semver bump: major (required event removed + opt→req transition)
```

## Change Classification

| Change | Suggested Bump |
|---|---|
| Optional event added | patch |
| Required event added | minor |
| req → optional transition | minor |
| Required event removed | **major** |
| opt → required transition | **major** (BREAKING) |
| Transport mode changed | **major** |
| Identical event sets | none |

Multiple triggers in one diff take the highest applicable bump level.

## Versioning Policy

See [docs/feature-bundles-versioning.md](../feature-bundles-versioning.md) for the full policy governing when to bump bundle versions and the deprecation workflow.

## Examples

```sh
# Compare two chat bundle versions
ec-bundle-diff chat@1.0.0 chat@2.0.0

# Check if a presence bundle minor bump is correct
ec-bundle-diff presence@1.0.0 presence@1.1.0
```

## CI Integration

Use `ec-bundle-diff` in CI to verify that the bundle version bump matches the actual event set changes:

```yaml
- name: Verify bundle version bump
  run: |
    # Compare current version against the prior tagged version
    ec-bundle-diff chat@1.0.0 chat@1.1.0
    # Exit 0 even when changes exist — human reviews the suggested bump
```

To enforce that a major bump is declared when required events are removed:

```sh
ec-bundle-diff chat@1.0.0 chat@2.0.0 | grep "Suggested semver bump: major"
```
