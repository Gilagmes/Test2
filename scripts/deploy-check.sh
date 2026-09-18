#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-${WEBAPP_URL:-}}"

if [[ -z "$BASE_URL" ]]; then
  echo "Usage: scripts/deploy-check.sh https://your-domain.example" >&2
  echo "Or set WEBAPP_URL=https://your-domain.example" >&2
  exit 1
fi

BASE_URL="${BASE_URL%/}"

echo "Checking $BASE_URL"

echo "1/4 HTML shell"
curl -fsSL "$BASE_URL" >/tmp/shonen-rift-index.html
grep -qi "Shonen Rift" /tmp/shonen-rift-index.html || {
  echo "Index HTML loaded, but title marker was not found" >&2
  exit 1
}

echo "2/4 API health"
HEALTH_JSON=$(curl -fsSL "$BASE_URL/health")
echo "$HEALTH_JSON"
echo "$HEALTH_JSON" | grep -q '"ok":true' || {
  echo "API health is not ok" >&2
  exit 1
}

echo "3/4 API leaderboard through same-origin proxy"
LEADERBOARD_JSON=$(curl -fsSL "$BASE_URL/api/leaderboard?limit=1")
echo "$LEADERBOARD_JSON"
echo "$LEADERBOARD_JSON" | grep -q '"ok":true' || {
  echo "Leaderboard endpoint is not ok" >&2
  exit 1
}

echo "4/4 Static assets"
curl -fsSI "$BASE_URL/assets/ui/title_bg.png" | grep -qi "200 OK"

echo "Deployment looks healthy."
