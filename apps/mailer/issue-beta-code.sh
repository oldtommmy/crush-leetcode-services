#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env.beta.local ]]; then
  echo "Missing .env.beta.local. Create it with BETA_ADMIN_SECRET first." >&2
  exit 1
fi

set -a
source .env.beta.local
set +a

if [[ -z "${BETA_ADMIN_SECRET:-}" ]]; then
  echo "Missing BETA_ADMIN_SECRET in .env.beta.local." >&2
  exit 1
fi

RECIPIENT_EMAIL="${1:-}"
GITHUB_USERNAME="${2:-}"
EXPIRES_AT="${3:-}"

if [[ -z "$RECIPIENT_EMAIL" ]]; then
  cat >&2 <<'USAGE'
Usage:
  bash issue-beta-code.sh <recipient-email> [github-username] [expires-at]

Examples:
  bash issue-beta-code.sh tommychan@foxmail.com oldtommmy
  bash issue-beta-code.sh user@example.com githubUser 2026-10-26T09:53:57.478Z
USAGE
  exit 1
fi

PAYLOAD="$(node - "$RECIPIENT_EMAIL" "$GITHUB_USERNAME" "$EXPIRES_AT" <<'NODE'
const [, , recipientEmail, githubUsername, expiresAt] = process.argv;
const payload = { recipientEmail };
if (githubUsername) payload.githubUsername = githubUsername;
if (expiresAt) payload.expiresAt = expiresAt;
process.stdout.write(JSON.stringify(payload));
NODE
)"

BASE_URL="${MAILER_BASE_URL:-http://127.0.0.1:8787}"

curl -s "$BASE_URL/api/issue-beta-code" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: $BETA_ADMIN_SECRET" \
  -d "$PAYLOAD"

echo
