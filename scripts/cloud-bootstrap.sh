#!/usr/bin/env bash
# クラウドの会話（Claude Code on the web・クラウドの定期実行）の SessionStart hook から呼ぶ想定。
# リポジトリが宣言している道具と依存を入れる。手元（CLAUDE_CODE_REMOTE が true でない）では何もしない。
# クラウド環境のセットアップスクリプトは環境に 1 本しか持てずリポジトリを知らないので、
# リポジトリごとの準備はこちらが持つ（対になるルールは rules/cloud-sessions.md）。
# 失敗してもセッションの開始は止めず、落ちた手順だけを標準出力に 1 行ずつ出す（モデルの文脈に渡る）。
set -u
case "${1:-}" in
  -h|--help)
    echo "usage: cloud-bootstrap.sh"
    echo "CLAUDE_CODE_REMOTE=true のときだけ、cwd のリポジトリの mise.toml・bun.lock・package-lock.json・uv.lock を見て"
    echo "mise install・bun install・npm ci・uv sync を流す。手元では何もしない。失敗しても終了 0 で、落ちた手順を 1 行ずつ出す"
    exit 0 ;;
esac

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

failed=""
run() {
  # 出力は捨てる。成功の記録は文脈を食うだけで、要るのは落ちた手順だけのため
  if ! "$@" >/dev/null 2>&1; then failed="${failed}cloud-bootstrap: \`$*\` が失敗した。必要なら手で流して原因を見る
"; fi
}

if [ -f mise.toml ] || [ -f .mise.toml ]; then
  if command -v mise >/dev/null 2>&1; then
    run mise trust --yes
    run mise install
    # mise の道具をこの後の Bash でも使えるようにする（CLAUDE_ENV_FILE は各コマンドの前に読まれる）
    if [ -n "${CLAUDE_ENV_FILE:-}" ]; then mise env -s bash >>"$CLAUDE_ENV_FILE" 2>/dev/null || true; fi
  else
    failed="${failed}cloud-bootstrap: mise.toml があるが mise が無い。クラウド環境のセットアップスクリプトに mise の導入を足す
"
  fi
fi
[ -n "${CLAUDE_ENV_FILE:-}" ] && [ -f "$CLAUDE_ENV_FILE" ] && . "$CLAUDE_ENV_FILE" 2>/dev/null

if [ -f bun.lock ] || [ -f bun.lockb ]; then run bun install --frozen-lockfile
elif [ -f package-lock.json ]; then run npm ci
fi
[ -f uv.lock ] && run uv sync --frozen

[ -n "$failed" ] && printf '%s' "$failed"
exit 0
