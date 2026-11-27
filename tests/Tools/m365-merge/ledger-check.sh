#!/bin/sh
# Ledger check for upstream merges (Untangle fork of solidtime, OPS-03 / D-04).
#
# Proves that docs/m365/TOUCHED-CORE-FILES.md (the ledger) explains every file the fork
# changes relative to upstream solidtime, and previews a merge without touching the tree:
#   1. every path the fork modified, deleted, renamed or retyped since the merge base
#      (outside .planning/) occurs backticked in the ledger            -> NOT IN LEDGER: <path>
#   2. every path the fork added since the merge base (outside .planning/) equals a
#      backticked ledger path or starts with a backticked ledger
#      directory (a token ending in "/")                                -> NOT COVERED: <path>
#   3. a merge preview (git merge-tree) of HEAD with the upstream ref conflicts only in
#      files that occur backticked in the ledger                         -> CONFLICT OUTSIDE LEDGER: <path>
#
# Environment:
#   UPSTREAM_REF  upstream commit or ref to compare with (default: upstream/main)
#   LEDGER        ledger file (default: docs/m365/TOUCHED-CORE-FILES.md)
#
# Output: "ledger-check: OK (modified <n>, added <m>, conflicts <k>)" and exit 0, or the
# findings followed by "ledger-check: FAILED" and exit 1. Exit 2 on a usage error.
#
# Local tool: run it from the repository root after `git fetch upstream --no-tags`.
# CI checkouts have no `upstream` remote, so it is not wired into CI.
# Procedure: docs/m365/UPSTREAM-MERGE.md.

UPSTREAM_REF="${UPSTREAM_REF:-upstream/main}"
LEDGER="${LEDGER:-docs/m365/TOUCHED-CORE-FILES.md}"

if [ ! -f "$LEDGER" ]; then
    echo "ledger-check: ledger not found: $LEDGER" >&2
    exit 2
fi
if ! git rev-parse --verify --quiet "$UPSTREAM_REF^{commit}" >/dev/null; then
    echo "ledger-check: unknown upstream ref '$UPSTREAM_REF' (git remote add upstream https://github.com/solidtime-io/solidtime.git && git fetch upstream --no-tags)" >&2
    exit 2
fi
BASE=$(git merge-base HEAD "$UPSTREAM_REF") || {
    echo "ledger-check: no merge base between HEAD and $UPSTREAM_REF" >&2
    exit 2
}

TMP=$(mktemp -d 2>/dev/null || mktemp -d -t ledgercheck)
trap 'rm -rf "$TMP"' EXIT INT TERM

# Ledger tokens, built once: every backticked span, one per line, CR stripped.
tr -d '\r' < "$LEDGER" | grep -o '`[^`]*`' | tr -d '`' | sort -u > "$TMP/tokens"

# Fork-side changes since the merge base, outside .planning/.
git -c core.quotepath=off diff --name-only --diff-filter=MDRT "$BASE" HEAD |
    grep -v '^\.planning/' > "$TMP/modified"
git -c core.quotepath=off diff --name-only --diff-filter=A "$BASE" HEAD |
    grep -v '^\.planning/' > "$TMP/added"

: > "$TMP/findings"

# Check 1: modified paths must be ledger tokens.
grep -Fvx -f "$TMP/tokens" "$TMP/modified" | sed 's/^/NOT IN LEDGER: /' >> "$TMP/findings"

# Check 2: added paths must be a ledger token or sit under a ledger directory token.
awk '
    NR == FNR { if ($0 != "") { exact[$0] = 1; if ($0 ~ /\/$/) dirs[++n] = $0 } ; next }
    $0 == "" { next }
    {
        if ($0 in exact) next
        for (i = 1; i <= n; i++) if (index($0, dirs[i]) == 1) next
        print "NOT COVERED: " $0
    }
' "$TMP/tokens" "$TMP/added" >> "$TMP/findings"

# Check 3: merge preview. Exit 1 means conflicts (expected), so no blanket set -e here.
git -c core.quotepath=off merge-tree --write-tree --name-only --no-messages HEAD "$UPSTREAM_REF" > "$TMP/mergetree"
MT_STATUS=$?
case "$MT_STATUS" in
    0) : > "$TMP/conflicts" ;;
    1) sed '1d' "$TMP/mergetree" | grep -v '^$' > "$TMP/conflicts" ;;
    *)
        echo "ledger-check: git merge-tree failed (exit $MT_STATUS)" >&2
        exit 2
        ;;
esac
grep -Fvx -f "$TMP/tokens" "$TMP/conflicts" | sed 's/^/CONFLICT OUTSIDE LEDGER: /' >> "$TMP/findings"

N_MOD=$(grep -c . "$TMP/modified")
N_ADD=$(grep -c . "$TMP/added")
N_CONF=$(grep -c . "$TMP/conflicts")

if [ -s "$TMP/findings" ]; then
    cat "$TMP/findings"
    echo "ledger-check: FAILED (modified $N_MOD, added $N_ADD, conflicts $N_CONF; base $BASE, upstream $UPSTREAM_REF)"
    exit 1
fi
echo "ledger-check: OK (modified $N_MOD, added $N_ADD, conflicts $N_CONF)"
exit 0
