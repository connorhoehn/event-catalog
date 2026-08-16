# @connorhoehn/event-catalog

Unified event registry and transport layer — schema enforcement, metrics, and
admin UI over Redis pub/sub and message-queue.

event-catalog is the authoritative declaration of every cross-service event in
the platform. It covers **both** durable (SQS-style, via `message-queue`) and
signal (WS-style, via Redis pub/sub) events. It is not a broker; messages flow
over Redis and message-queue, not through this service.

## Quick start

```bash
# Install as a library consumer
npm install @connorhoehn/event-catalog

# Run the service locally
docker compose up     # redis + message-queue + event-catalog on :3010
npm run dev           # or: tsx watch src/cli/index.ts
```

## CLI tools

| Command | Description |
|---------|-------------|
| `ec-lint-crd <path>` | Validate CRD YAML files against the bundle catalog |
| `ec-bundle-diff <name@v1> <name@v2>` | Compare two bundle versions; suggests semver bump |
| `ec-bundle-create <name>` | Scaffold a new FeatureBundle file |

### CLI reference

- [`docs/cli/lint-crd.md`](docs/cli/lint-crd.md)
- [`docs/cli/bundle-diff.md`](docs/cli/bundle-diff.md)
- [`docs/cli/bundle-create.md`](docs/cli/bundle-create.md)

## CI Integration

Ready-made templates for wiring the CLI into GitHub Actions and git hooks:

- **GitHub Actions workflow** — [`templates/github-actions/lint-crds.yml`](templates/github-actions/lint-crds.yml)
  Drop into `.github/workflows/lint-crds.yml` in any repo that holds CRDs.
- **Pre-commit hook** — [`templates/git-hooks/pre-commit-lint-crd.sh`](templates/git-hooks/pre-commit-lint-crd.sh)
  Copy to `.git/hooks/pre-commit` and `chmod +x`.

Full guide including CircleCI, GitLab CI, exit code semantics, fingerprint drift
workflow, and strict mode: [`docs/cli/ci-integration.md`](docs/cli/ci-integration.md).

### Exit codes (quick reference)

| Code | Meaning |
|------|---------|
| `0` | Clean |
| `1` | Error (missing bundle, stale fingerprint) — fails PR |
| `2` | Warnings only (deprecated bundle) — passes by default, fails in strict mode |

Fail on errors only (recommended default):

```bash
npx ec-lint-crd crds/ || [ $? -eq 2 ]
```

Fail on errors and warnings (strict mode):

```bash
npx ec-lint-crd crds/
```

## Subpath exports

```typescript
import { catalog }              from '@connorhoehn/event-catalog';           // main library
import { pipelineDeclarations } from '@connorhoehn/event-catalog/pipeline';  // pipeline event decls
import { publishSignal }        from '@connorhoehn/event-catalog/signal';    // signal transport
import { publishDurable }       from '@connorhoehn/event-catalog/durable';   // durable transport
import { EventRegistry }        from '@connorhoehn/event-catalog/registry';  // local registry
import { DLQClient }            from '@connorhoehn/event-catalog/dlq';       // DLQ browser
```

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — system architecture
- [`docs/feature-bundles-design.md`](docs/feature-bundles-design.md) — FeatureBundle design
- [`docs/feature-bundles-versioning.md`](docs/feature-bundles-versioning.md) — versioning policy
- [`docs/cli/ci-integration.md`](docs/cli/ci-integration.md) — CI integration guide
- [`ROADMAP.md`](ROADMAP.md) — phase E1–E8 progression
- [`CHANGELOG.md`](CHANGELOG.md) — release history
