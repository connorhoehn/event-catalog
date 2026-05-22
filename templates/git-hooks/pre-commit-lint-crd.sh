#!/usr/bin/env bash
# Pre-commit hook: lint any staged YAML files that look like platform CRDs.
#
# INSTALL
#   cp templates/git-hooks/pre-commit-lint-crd.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
#
#   Or with the pre-commit framework (https://pre-commit.com/), add to .pre-commit-config.yaml:
#     repos:
#       - repo: local
#         hooks:
#           - id: ec-lint-crd
#             name: Lint platform CRDs
#             entry: npx ec-lint-crd
#             language: node
#             files: '\.ya?ml$'
#
# EXIT CODE BEHAVIOUR
#   The hook exits 1 on any lint error, which aborts the commit.
#   Deprecation warnings (exit 2 from ec-lint-crd) are printed but do not
#   abort the commit. Set STRICT=1 to abort on warnings too.
#
# BYPASS (escape hatch)
#   git commit --no-verify
#   This bypasses ALL hooks — use sparingly and track the skip in the commit message.

set -euo pipefail

# Collect staged YAML files
staged=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(yaml|yml)$' || true)

if [ -z "$staged" ]; then
  exit 0
fi

# Filter to files that contain a platform.connorhoehn.dev apiVersion line
platform_files=""
for f in $staged; do
  [ -f "$f" ] || continue
  if grep -q 'apiVersion: platform.connorhoehn.dev' "$f" 2>/dev/null; then
    platform_files="$platform_files $f"
  fi
done

if [ -z "$platform_files" ]; then
  exit 0
fi

echo "[pre-commit] Linting platform CRDs: $platform_files"

worst_exit=0
for f in $platform_files; do
  # Run ec-lint-crd; capture exit code without aborting the loop
  npx ec-lint-crd "$f" || {
    code=$?
    [ $code -gt $worst_exit ] && worst_exit=$code
  }
done

# Exit 1 = hard error → always block the commit
if [ $worst_exit -eq 1 ]; then
  echo "[pre-commit] CRD lint errors found. Fix the errors above or run:"
  echo "  ec-lint-crd <file> --fix-fingerprints   # to auto-update stale fingerprints"
  exit 1
fi

# Exit 2 = warnings only (deprecated bundles)
if [ $worst_exit -eq 2 ]; then
  if [ "${STRICT:-0}" = "1" ]; then
    echo "[pre-commit] Strict mode: deprecated bundle references are not allowed. Update your CRDs."
    exit 1
  else
    echo "[pre-commit] Warning: one or more CRDs reference deprecated bundles (commit allowed)."
    echo "  Run 'ec-lint-crd --list-deprecated' to see which bundles need updating."
  fi
fi

exit 0
