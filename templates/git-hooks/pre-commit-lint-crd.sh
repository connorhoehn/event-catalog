#!/usr/bin/env bash
# Pre-commit hook: lint any staged YAML files that look like platform CRDs.
#
# INSTALL
#   Copy this file out of the installed package (it is not shipped in the npm
#   tarball — grab it from the event-catalog repo) into your own repo:
#
#     cp pre-commit-lint-crd.sh .git/hooks/pre-commit
#     chmod +x .git/hooks/pre-commit
#
#   Or with the pre-commit framework (https://pre-commit.com/), add to .pre-commit-config.yaml:
#     repos:
#       - repo: local
#         hooks:
#           - id: ec-lint-crd
#             name: Lint platform CRDs
#             entry: ec-lint-crd
#             language: node
#             files: '\.ya?ml$'
#
# REQUIREMENTS
#   `ec-lint-crd` must be resolvable — either installed in this repo
#   (`npm i -D @connorhoehn/event-catalog`, giving node_modules/.bin/ec-lint-crd)
#   or on your PATH. The package lives on the GitHub Packages registry, so a
#   bare `npx ec-lint-crd` cannot download it on demand; if the binary is
#   missing this hook FAILS the commit rather than passing silently.
#
# EXIT CODE CONTRACT OF ec-lint-crd (as of v0.5.0)
#   0  clean
#   1  at least one CRD has an error (missing bundle, stale fingerprint)
#   2  usage error — bad flag, missing/typo'd path. The lint NEVER RAN.
#   3  completed with warnings only (deprecated bundle reference)
#
#   This hook blocks the commit on 1 and on 2. Code 2 must never be treated as
#   "acceptable": it means the linter was invoked wrongly and checked nothing.
#   Code 3 prints a warning and allows the commit; set STRICT=1 to block on it.
#
# BYPASS (escape hatch)
#   git commit --no-verify
#   This bypasses ALL hooks — use sparingly and track the skip in the commit message.

set -uo pipefail

# ---------------------------------------------------------------------------
# Collect staged YAML files that are actually platform CRDs
# ---------------------------------------------------------------------------
# NUL-delimited so paths containing spaces survive.

files=()
while IFS= read -r -d '' f; do
  [ -f "$f" ] || continue
  if grep -q 'apiVersion: platform.connorhoehn.dev' "$f" 2>/dev/null; then
    files+=("$f")
  fi
done < <(git diff --cached --name-only -z --diff-filter=ACM -- '*.yaml' '*.yml')

if [ ${#files[@]} -eq 0 ]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Resolve the linter
# ---------------------------------------------------------------------------

repo_root=$(git rev-parse --show-toplevel)

if [ -x "$repo_root/node_modules/.bin/ec-lint-crd" ]; then
  linter=("$repo_root/node_modules/.bin/ec-lint-crd")
elif command -v ec-lint-crd >/dev/null 2>&1; then
  linter=(ec-lint-crd)
else
  echo "[pre-commit] ec-lint-crd not found — cannot validate CRDs."
  echo "  Install it:  npm i -D @connorhoehn/event-catalog"
  echo "  Or bypass:   git commit --no-verify"
  exit 1
fi

echo "[pre-commit] Linting platform CRDs: ${files[*]}"

# ec-lint-crd takes many paths in one invocation and folds them into a single
# exit code with the right precedence (any error ⇒ 1, warnings only ⇒ 3).
# Do NOT loop and take the numeric max of per-file codes: 3 > 1 numerically,
# so a warning in one file would mask a hard error in another.
code=0
"${linter[@]}" "${files[@]}" || code=$?

case $code in
  0)
    exit 0
    ;;
  1)
    echo "[pre-commit] CRD lint errors found. Fix the errors above or run:"
    echo "  ec-lint-crd <file> --fix-fingerprints   # to auto-update stale fingerprints"
    exit 1
    ;;
  2)
    echo "[pre-commit] ec-lint-crd exited 2 (usage error) — the CRDs were NOT checked."
    echo "  This is a hook bug or a bad install, not a CRD problem. Blocking the commit."
    exit 1
    ;;
  3)
    if [ "${STRICT:-0}" = "1" ]; then
      echo "[pre-commit] Strict mode: deprecated bundle references are not allowed. Update your CRDs."
      exit 1
    fi
    echo "[pre-commit] Warning: one or more CRDs reference deprecated bundles (commit allowed)."
    echo "  Run 'ec-lint-crd --list-deprecated' to see which bundles need updating."
    exit 0
    ;;
  *)
    echo "[pre-commit] ec-lint-crd exited with unexpected code $code — blocking the commit."
    exit 1
    ;;
esac
