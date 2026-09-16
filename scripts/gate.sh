#!/usr/bin/env bash
# 提交门禁的机器部分（G0 的门 1/2/4/6）。
# 门 3（/review）与门 5（effective-testing）是 skill 动作，由执行 agent 显式完成，脚本不覆盖。
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-full}"

# pnpm 可能不在钩子/子进程的 PATH 上（nvm 惰性函数场景）——找不到时扫 nvm
# 版本目录，并把 pnpm 所在目录注入 PATH（pnpm 内部子进程也要能再找到它）。
if ! command -v pnpm >/dev/null 2>&1; then
  for d in "$HOME"/.nvm/versions/node/*/bin; do
    if [ -x "$d/pnpm" ]; then export PATH="$d:$PATH"; break; fi
  done
fi
command -v pnpm >/dev/null 2>&1 || { echo "_GATE_FAIL pnpm 不可用（PATH 无且 nvm 目录未找到）"; exit 1; }

require_env() {
  [[ -f .env ]] || { echo "_GATE_FAIL .env 不存在（cp .env.example .env 并填值）"; exit 1; }
  grep -q '^ENABLE_INTEGRATION_TESTS=true' .env \
    || { echo "_GATE_FAIL ENABLE_INTEGRATION_TESTS!=true：集成测试会静默跳过（假绿）"; exit 1; }
  local key
  key="$(grep '^OPENAI_API_KEY=' .env | head -1 | cut -d= -f2-)"
  [[ -n "$key" && "$key" != "your_api_key_here" ]] \
    || { echo "_GATE_FAIL OPENAI_API_KEY 缺失或为占位符"; exit 1; }
}

assert_no_skipped() {
  local log="$1"
  # vitest 汇总行形如 "Tests  12 passed | 3 skipped"
  if grep -E '[1-9][0-9]* skipped' "$log" >/dev/null; then
    echo "_GATE_FAIL 存在 skipped 集成用例——环境未启用或用例被跳过，属假绿，禁止提交"
    exit 1
  fi
}

case "$MODE" in
  static)
    pnpm build || { echo "_GATE_FAIL build"; exit 1; }
    pnpm lint || { echo "_GATE_FAIL lint"; exit 1; }
    ;;
  unit)   pnpm test:unit ;;
  intg)
    require_env
    log="$(mktemp)"
    pnpm test:intg 2>&1 | tee "$log"
    assert_no_skipped "$log"
    ;;
  full)
    # 注意：case 分支内 set -e 对 AND-list 失败不生效（bash 陷阱：a && b && c 失败
    # 不会退出，后续 intg 照跑）——必须逐行显式退出。
    pnpm build || { echo "_GATE_FAIL build"; exit 1; }
    pnpm lint || { echo "_GATE_FAIL lint"; exit 1; }
    pnpm test:unit || { echo "_GATE_FAIL unit"; exit 1; }
    log="$(mktemp)"
    pnpm test:intg 2>&1 | tee "$log" || { echo "_GATE_FAIL intg"; exit 1; }
    assert_no_skipped "$log"
    echo "_GATE_OK 门1/2/4/6 通过；门3(/review) 与门5(effective-testing) 由 agent 显式完成后方可提交"
    ;;
  *) echo "用法: bash scripts/gate.sh [static|unit|intg|full]"; exit 2 ;;
esac
