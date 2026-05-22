# CI Integration

This page shows how to wire `ec-lint-crd`, `ec-bundle-diff`, and `ec-bundle-create`
into your CI pipeline and local git workflow.

## Exit code semantics

All three CLI tools share a consistent exit code contract:

| Code | Meaning | PR behaviour |
|------|---------|--------------|
| `0` | Clean — all checks passed | Pass |
| `1` | Error — missing bundle, stale fingerprint, bundle not found | Fail |
| `2` | Warnings only — deprecated bundle reference (lint); usage error (diff/create) | Pass by default; fail in strict mode |

The key distinction: **exit 1 always blocks, exit 2 only blocks in strict mode.**

## How to fail on errors only (default)

This is the recommended mode for most teams. Deprecated-bundle warnings are surfaced
as log output but do not block the PR:

```yaml
- name: Lint CRDs
  run: npx ec-lint-crd crds/ || [ $? -eq 2 ]
```

The `|| [ $? -eq 2 ]` clause absorbs warnings-only exits while letting hard errors
(exit 1) propagate and fail the step.

## How to fail on warnings too (strict mode)

Use strict mode in release pipelines or when you want to enforce that no CRD ever
references a deprecated bundle:

```yaml
- name: Lint CRDs (strict)
  run: npx ec-lint-crd crds/
  # Any non-zero exit (1 = error, 2 = deprecated) fails the step.
```

Or in a shell script, check for any non-zero exit explicitly:

```bash
npx ec-lint-crd crds/ && echo "clean" || exit 1
```

---

## GitHub Actions

A ready-made workflow is at [`templates/github-actions/lint-crds.yml`](../../templates/github-actions/lint-crds.yml).

Drop it into your repo's `.github/workflows/` directory:

```bash
cp node_modules/@connorhoehn/event-catalog/templates/github-actions/lint-crds.yml \
   .github/workflows/lint-crds.yml
```

The workflow:
- Triggers on pull requests that touch `crds/**`, `k8s/**/*.yaml`, or `docs/**/*.yaml`
- Installs the event-catalog CLI
- Diffs against the PR base to find changed files
- Filters to files containing `apiVersion: platform.connorhoehn.dev`
- Lints each file, failing on errors (exit 1), passing on warnings (exit 2)
- Includes an optional strict-mode step (set `STRICT_MODE: 'true'` env var to enable)
- Includes an informational `ec-bundle-diff` step for event-catalog repo PRs

### Minimal inline recipe

If you don't want the full template, here is the bare minimum:

```yaml
name: Lint CRDs

on:
  pull_request:
    paths:
      - 'crds/**'

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install event-catalog CLI
        run: npm install --no-save @connorhoehn/event-catalog@0.3.47
      - name: Lint CRDs
        run: ./node_modules/.bin/ec-lint-crd crds/ || [ $? -eq 2 ]
```

### Pinning the version

Pin to a specific release to avoid unexpected behaviour from new catalog checks:

```yaml
run: npm install --no-save @connorhoehn/event-catalog@0.3.47
```

Replace `0.3.47` with the version matching your deployed event-catalog service.
The CLI and service must agree on bundle schema format.

---

## Pre-commit hook

A ready-made hook is at [`templates/git-hooks/pre-commit-lint-crd.sh`](../../templates/git-hooks/pre-commit-lint-crd.sh).

### Install (direct)

```bash
cp node_modules/@connorhoehn/event-catalog/templates/git-hooks/pre-commit-lint-crd.sh \
   .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

### Install (pre-commit framework)

If your team uses [pre-commit](https://pre-commit.com/), add this to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: ec-lint-crd
        name: Lint platform CRDs
        entry: npx ec-lint-crd
        language: node
        files: '\.ya?ml$'
        pass_filenames: true
```

Then install the hooks:

```bash
pre-commit install
```

### Strict mode (hook)

The hook respects a `STRICT` environment variable. To fail on deprecated bundles too:

```bash
STRICT=1 git commit -m "feat: update CRD"
```

Or set it permanently in your shell profile:

```bash
export STRICT=1
```

### Bypass (escape hatch)

```bash
git commit --no-verify -m "chore: bypass lint for this commit"
```

Use sparingly. Prefer `ec-lint-crd --fix-fingerprints` to auto-update stale fingerprints
rather than skipping the check.

---

## CircleCI

```yaml
version: 2.1

jobs:
  lint-crds:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - run:
          name: Install event-catalog CLI
          command: npm install --no-save @connorhoehn/event-catalog@0.3.47
      - run:
          name: Lint CRDs
          command: ./node_modules/.bin/ec-lint-crd crds/ || [ $? -eq 2 ]

workflows:
  ci:
    jobs:
      - lint-crds:
          filters:
            branches:
              ignore: main
```

---

## GitLab CI

```yaml
lint-crds:
  image: node:20-alpine
  stage: test
  only:
    changes:
      - crds/**/*.yaml
      - k8s/**/*.yaml
  script:
    - npm install --no-save @connorhoehn/event-catalog@0.3.47
    - ./node_modules/.bin/ec-lint-crd crds/ || [ $? -eq 2 ]
  allow_failure: false
```

For strict mode (fail on deprecated too):

```yaml
lint-crds-strict:
  script:
    - npm install --no-save @connorhoehn/event-catalog@0.3.47
    - ./node_modules/.bin/ec-lint-crd crds/
```

---

## Bare shell (any CI)

The commands work in any environment with Node 20+:

```bash
# Install
npm install --no-save @connorhoehn/event-catalog@0.3.47

# Lint a directory (warn on deprecated, fail on errors)
./node_modules/.bin/ec-lint-crd crds/ || [ $? -eq 2 ]

# Lint a single file
./node_modules/.bin/ec-lint-crd deploy/my-feature.yaml

# Fix stale fingerprints in-place
./node_modules/.bin/ec-lint-crd crds/ --fix-fingerprints

# List all deprecated bundles
./node_modules/.bin/ec-lint-crd --list-deprecated

# Diff two bundle versions
./node_modules/.bin/ec-bundle-diff chat@1.0.0 chat@1.1.0
```

---

## Fingerprint drift workflow

When a bundle's event set changes and a new bundle version is published,
existing CRDs that pin a fingerprint will fail lint with a "fingerprint mismatch" error.

**Automatic fix:**

```bash
ec-lint-crd crds/ --fix-fingerprints
git diff crds/          # review the rewritten fingerprints
git add crds/ && git commit -m "chore: update CRD fingerprints to chat@1.1.0"
```

**Manual fix** — update the `spec.eventBundle` field in the CRD:

```yaml
# Before
spec:
  eventBundle: "chat@1.0.0#cae711784c55"

# After
spec:
  eventBundle: "chat@1.1.0#def456789abc"
```

Run `ec-bundle-diff chat@1.0.0 chat@1.1.0` to see what events changed before
updating consumer CRDs.

---

## Related docs

- [`docs/cli/lint-crd.md`](./lint-crd.md) — `ec-lint-crd` reference
- [`docs/cli/bundle-diff.md`](./bundle-diff.md) — `ec-bundle-diff` reference
- [`docs/cli/bundle-create.md`](./bundle-create.md) — `ec-bundle-create` reference
- [`docs/feature-bundles-versioning.md`](../feature-bundles-versioning.md) — versioning policy
