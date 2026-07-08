#!/bin/bash
# docker compose로 backend + frontend를 빌드하고 띄우는 wrapper.
# 기본은 포그라운드 실행(로그 바로 보임). -d를 주면 백그라운드로 띄우고 로그를 tail한다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DETACH=false
for arg in "$@"; do
  case "$arg" in
    -d|--detach) DETACH=true ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

for env_file in backend/.env data-pipeline/.env; do
  if [[ ! -f "$env_file" ]]; then
    echo "경고: $env_file 가 없습니다. 필요한 값은 ${env_file}.example 참고." >&2
  fi
done

if $DETACH; then
  docker compose up --build -d
  docker compose logs -f
else
  docker compose up --build
fi
