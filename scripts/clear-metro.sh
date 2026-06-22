#!/usr/bin/env bash
# Kill any stale Metro packager and clear all RN/Metro caches, then start fresh.
# Usage:  npm run reset    (or)   bash scripts/clear-metro.sh
#         bash scripts/clear-metro.sh --no-start   # just clear, don't launch

echo "🔪 Killing any Metro/packager on :8081 ..."
lsof -tiTCP:8081 -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null && echo "   killed" || echo "   none running"

echo "🔪 Killing stray RN cli/metro node processes ..."
pkill -f "react-native/cli.js start" 2>/dev/null && echo "   killed" || echo "   none"

echo "🧹 watchman ..."
watchman watch-del-all >/dev/null 2>&1 || true

echo "🧹 metro / haste temp ..."
rm -rf "${TMPDIR:-/tmp}"/metro-* "${TMPDIR:-/tmp}"/metro-cache "${TMPDIR:-/tmp}"/haste-map-* 2>/dev/null || true
rm -rf node_modules/.cache 2>/dev/null || true

echo "✅ Caches cleared."

if [ "$1" == "--no-start" ]; then
  echo "ℹ️  Skipping start (--no-start). Run 'npm start -- --reset-cache' when ready."
  exit 0
fi

echo "▶️  Starting Metro fresh (react-native start --reset-cache) ..."
npx react-native start --reset-cache
