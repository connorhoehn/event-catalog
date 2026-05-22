# ec-lint-crd

Validates Kubernetes CRD YAML files against the event-catalog FeatureBundle registry.

Walks YAML files (or a directory recursively), finds CRDs with `apiVersion: platform.connorhoehn.dev/*`, and for each one checks:

1. The `spec.eventBundle` reference resolves to a registered FeatureBundle
2. If a fingerprint is pinned (e.g. `chat@1.0.0#cae711784c55`), it matches the catalog fingerprint
3. Warns when the referenced bundle version is deprecated

## Usage

```
ec-lint-crd <path-to-yaml-file-or-dir> [--fix-fingerprints]
ec-lint-crd --help
```

| Argument | Description |
|---|---|
| `<path>` | YAML file or directory (scanned recursively) |
| `--fix-fingerprints` | Rewrite stale fingerprints in-place with current catalog values |
| `--help`, `-h` | Show help |

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | All checked CRDs are valid |
| `1` | At least one CRD has an error (bundle not found, fingerprint mismatch) |
| `2` | Usage error or warnings-only (deprecated bundles, no input provided) |

## Bundle Reference Format

```
spec:
  eventBundle: "chat@1.0.0"             # name + version, no fingerprint
  eventBundle: "chat@1.0.0#cae711784c55" # pinned 12-char fingerprint (recommended for CI)
  eventBundle: "chat@1.0.0#cae711784c55a33194c2274bb34c4d25463c60736f7c9eb64c20e142e429d6e0" # full 64-char fingerprint
```

The fingerprint is checked as a prefix match so both 12-char truncated and full 64-char hashes work.

## Example Output

```
CRD: ChatRoom/engineering-general (deploy/chatroom.yaml:14)
  ✓ eventBundle: chat@1.0.0 exists
  ✓ fingerprint matches (cae711784c55)

CRD: AgenticPipeline/my-pipeline (deploy/pipeline.yaml:8)
  ✗ eventBundle: nonexistent@1.0.0 — BUNDLE NOT FOUND

CRD: RealtimeChannel/old-channel (deploy/channel.yaml:22)
  ! eventBundle: chat@0.9.0 — version is deprecated since 1.0.0 — use chat@1.0.0 instead

Summary: 3 checked, 1 error(s), 1 warning(s)
```

Symbols:
- `✓` — check passed
- `✗` — error (causes exit 1)
- `!` — warning / deprecation (causes exit 2)
- `·` — informational (fingerprint not pinned)

## CI Integration

### GitHub Actions

```yaml
- name: Validate CRD bundles
  run: npx ec-lint-crd crds/
```

Or with a pinned version of event-catalog:

```yaml
- name: Install event-catalog
  run: npm install @connorhoehn/event-catalog@latest

- name: Validate CRD bundles
  run: npx ec-lint-crd deploy/crds/
```

### Pre-commit Hook

Add to `.git/hooks/pre-commit` (or use [pre-commit](https://pre-commit.com/)):

```sh
#!/bin/sh
# Lint changed CRD YAML files before commit
changed=$(git diff --cached --name-only --diff-filter=ACM | grep '\.ya\?ml$')
if [ -n "$changed" ]; then
  npx ec-lint-crd $changed || exit 1
fi
```

### Fix Fingerprints

When bundle fingerprints drift (e.g. after adding events to a bundle), run:

```sh
ec-lint-crd crds/ --fix-fingerprints
```

This rewrites all pinned fingerprints in-place with the current catalog values. Review the diff before committing.

## Non-platform CRDs

Only CRDs with `apiVersion: platform.connorhoehn.dev/*` are checked. Standard Kubernetes resources (`apps/v1 Deployment`, `networking.k8s.io/v1 Ingress`, etc.) are silently skipped and do not affect the exit code.

CRDs that have no `spec.eventBundle` field are also skipped.

## Available Bundles

Run `event-catalog` server and visit `/api/bundles` to see all registered bundles, or check `src/declarations/bundles/` in this repo.
