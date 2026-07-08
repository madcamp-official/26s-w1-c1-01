#!/bin/bash
# 크론에서 main_batch.py를 매시간 실행하기 위한 wrapper.
# 크론에는 로그인 셸의 PATH/venv가 없으므로 venv 활성화까지 이 스크립트가 책임진다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

cd "$SCRIPT_DIR"
source venv/bin/activate

python3 main_batch.py >> "$LOG_DIR/batch_$(date +%Y%m%d).log" 2>&1
