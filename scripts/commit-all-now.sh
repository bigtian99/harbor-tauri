#!/bin/bash
set -euo pipefail
cd /Users/daijunxiong/Desktop/tauri/jar-to-harbor

echo "=== status ==="
git status -sb
echo "=== porcelain ==="
git status --porcelain
echo "=== log ==="
git log -5 --oneline
echo "=== branch ==="
git branch -vv
echo "=== diffstat ==="
git diff --stat
git diff --cached --stat || true

# stage project files (exclude junk)
git add -A -- . \
  ':!node_modules' \
  ':!src-tauri/target' \
  ':!dist' \
  ':!**/.DS_Store' \
  ':!**/Cargo.lock.bak' 2>/dev/null || true

# explicit key paths in case -A filters oddly
git add \
  .github/workflows/build.yml \
  package.json \
  scripts/release.mjs \
  scripts/set-version.mjs \
  scripts/do-release-now.mjs \
  scripts/commit-ci-fix.sh \
  src/App.tsx \
  src/App.css \
  src/components/ConfigPanel.tsx \
  src/components/UpdateModal.tsx \
  src/components/UpdateModal.css \
  src-tauri/src/updater.rs \
  src-tauri/src/landing.rs \
  src-tauri/src/lib.rs \
  src-tauri/Cargo.toml \
  src-tauri/tauri.conf.json \
  2>/dev/null || true

echo "=== staged ==="
git status --short
git diff --cached --name-only

if git diff --cached --quiet; then
  echo "Nothing to commit"
  exit 0
fi

git commit -m "$(cat <<'EOF'
feat: 更新体验闭环（进度/说明/关于页检查）与 Release CI 修复

- 更新弹窗展示 release notes（可滚动）
- 下载进度：async+spawn_blocking，避免阻塞 UI
- 设置→关于：版本展示 + 手动检查更新
- 诊断日志新在前；release 脚本以 package.json 为源自动 bump
- CI：gh release upload --clobber，修复 asset 同名 404 / isLatest
EOF
)"

echo "=== after ==="
git status -sb
git log -1 --format='%h %s'
