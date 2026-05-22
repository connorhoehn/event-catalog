# FeatureBundle Versioning Policy

Bundles follow semver-ish semantics applied to their EVENT REFERENCES, not the bundle wrapper itself.

## Versioning rules

### Patch bump (1.0.0 → 1.0.1)
- Comment / description changes to bundle metadata
- New OPTIONAL event added
- Deprecated metadata on the bundle

### Minor bump (1.0.0 → 1.1.0)
- New REQUIRED event added (breaks consumers who don't yet handle it — but they can ignore unknowns)
- Existing event marked deprecated (replacement should be added in same bump)

### Major bump (1.0.0 → 2.0.0)
- Required event REMOVED
- Existing event's schema breaking change
- Transport mode changed (signal ↔ durable)

## When NOT to bump

- An event in the bundle bumps its own schema version: the bundle re-references it via fingerprint, so the bundle fingerprint changes but the bundle SEMVER doesn't necessarily — judgement call based on backward compat
- New events added to the catalog but NOT in this bundle: no bump

## Deprecation flow

When a bundle is deprecated:
1. Set `deprecated.since` to current ISO date
2. Set `deprecated.replacement` if a successor exists (e.g., 'chat@2.0.0')
3. Mark deprecated in bundle definition file
4. Ship a patch version with the deprecation metadata
5. After 90 days minimum, consider removing from active catalog

CRDs that reference the deprecated bundle get `--list-deprecated` CLI warnings.

## Cross-bundle dependencies

Bundles should not reference other bundles. If event reuse is needed, the event lives in the catalog at the top level and multiple bundles can reference it independently.

## Pin policy for CRDs

CRDs should pin to `{name}@{version}` (not pin fingerprint by default). Fingerprint pinning is reserved for high-stakes resources where any bundle drift must be intentional (e.g., audit-critical pipelines).

When a CRD pins by name+version:
- Patch bumps: no action needed
- Minor bumps: review on next CRD edit
- Major bumps: required action (update CRD spec)

## Tooling

- `ec-lint-crd` reports stale fingerprints + deprecated bundle refs
- `ec-bundle-diff <name>@<v1> <name>@<v2>` shows event set changes (planned)
- CI integration: lint changed CRDs on every PR
