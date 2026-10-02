#!/bin/bash
# cloud-setup.sh — SessionStart 훅. claude.ai/code 의 원격 세션(CLAUDE_CODE_REMOTE=true)에서만 돈다.
# 세션마다 새로 클론되므로 prototypes.json 의 프로토타입마다 의존성을 깔고, 미리 깔린 Chromium 을 CHROME_PATH 로 잡는다.
# npm ci 를 쓴다 — package-lock.json 을 고치지 않는다(작업 트리가 깨끗해야 한다). 한 프로토타입이 실패해도 나머지는 깐다.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT" || exit 0

dirs=$(node -e 'for (const p of JSON.parse(require("fs").readFileSync("prototypes.json", "utf8")).prototypes) console.log(p.dir)' 2>/dev/null)
for dir in $dirs; do
  if [ -f "$dir/package-lock.json" ]; then
    if npm ci --prefix "$dir" --no-audit --no-fund --loglevel=error >/dev/null 2>&1; then
      echo "cloud-setup: $dir npm ci ok" >&2
    else
      echo "cloud-setup: $dir npm ci 실패 — 그 폴더에서 npm ci 를 직접 돌려 본다" >&2
    fi
  fi
done

if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -x /opt/pw-browsers/chromium ]; then
  echo 'export CHROME_PATH=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
fi
exit 0
