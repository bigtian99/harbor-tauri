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
echo "=== diff stat ==="
git diff --stat
git diff --cached --stat

# stage known files
git add .github/workflows/build.yml \
  package.json \
  scripts/release.mjs \
  scripts/set-version.mjs \
  scripts/do-release-now.mjs \
  src/components/UpdateModal.tsx \
  src/components/UpdateModal.css \
  src-tauri/src/updater.rs \
  src-tauri/src/landing.rs \
  src-tauri/Cargo.toml \
  src-tauri/tauri.conf.json 2>/dev/null || true

# add any other modified tracked files except junk
git add -u -- . ':!node_modules' ':!src-tauri/target' ':!dist' 2>/dev/null || true

echo "=== staged ==="
git status --short

if git diff --cached --quiet; then
  echo "Nothing to commit"
  exit 0
fi

git commit -m "$(cat <<'EOF'
ci: 修复 GitHub Release 上传失败（asset 同名 404 / isLatest 字段）

- 矩阵产物去重命名（ops 加 -ops 后缀）
- softprops 改为 gh release upload --clobber
- release view 去掉不支持的 isLatest
- release 脚本以 package.json 为源自动 patch
EOF
)"

echo "=== after commit ==="
git status -sb
git log -1 --oneline
