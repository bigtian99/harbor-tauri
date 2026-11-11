#!/usr/bin/env bash
# 从设计稿 app-icon.png 生成各平台图标资产。
#
# 两套规格不能混用：
#   macOS 26+：icon.icns 必须是「满幅、不透明、方形」，圆角由系统统一套用。
#     自带圆角/透明留白的旧式图标会被系统判定为普通图片，套一层银色/玻璃
#     背板并把内容缩小居中（Dock 里看起来「logo 没铺满」）。
#   Windows / Linux / 网页：系统不替图标套圆角，必须保留自带的圆角与透明角。
#
# 因此不要用 `pnpm tauri icon` 全量重生成：它会从同一张源图产出 icns，
# 把 macOS 的满幅处理覆盖掉，也会让 Windows 图标变成直角方块。
# 改动设计稿后只需重跑本脚本。
#
# 依赖：ImageMagick (magick)、iconutil（macOS）、python3。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/app-icon.png"
ICONS="$ROOT/src-tauri/icons"
PUB="$ROOT/public"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for cmd in magick iconutil python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "缺少依赖：$cmd" >&2
    exit 1
  fi
done

if [ ! -f "$SRC" ]; then
  echo "找不到设计稿：$SRC" >&2
  exit 1
fi

# 1. 裁掉设计稿四周的透明留白，得到「圆角方块铺满画布」的母版（保留透明四角）。
#    设计稿裁边后约 1065x1063，拉成 1024 正方形的形变 <0.2%，可忽略。
magick "$SRC" -trim +repage -filter Lanczos -resize '1024x1024!' "$TMP/rounded.png"

# 2. macOS 母版：把透明四角填成图标底色，得到完全不透明的满幅方形。
#    系统随后自行套圆角，被裁掉的四角不会露出。
magick "$TMP/rounded.png" -background '#011634' -alpha remove -alpha off "$TMP/macos.png"

# 3. 用 iconset 生成 icon.icns（iconutil 会补齐 16/32 的 legacy 条目与 mask）。
ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 64 128 256 512 1024; do
  magick "$TMP/macos.png" -filter Lanczos -resize "${s}x${s}!" "$ICONSET/_${s}.png"
done
cp "$ICONSET/_16.png"   "$ICONSET/icon_16x16.png"
cp "$ICONSET/_32.png"   "$ICONSET/icon_16x16@2x.png"
cp "$ICONSET/_32.png"   "$ICONSET/icon_32x32.png"
cp "$ICONSET/_64.png"   "$ICONSET/icon_32x32@2x.png"
cp "$ICONSET/_128.png"  "$ICONSET/icon_128x128.png"
cp "$ICONSET/_256.png"  "$ICONSET/icon_128x128@2x.png"
cp "$ICONSET/_256.png"  "$ICONSET/icon_256x256.png"
cp "$ICONSET/_512.png"  "$ICONSET/icon_256x256@2x.png"
cp "$ICONSET/_512.png"  "$ICONSET/icon_512x512.png"
cp "$ICONSET/_1024.png" "$ICONSET/icon_512x512@2x.png"
rm "$ICONSET"/_*.png
iconutil -c icns -o "$ICONS/icon.icns" "$ICONSET"

# 4. 网页图标：只去掉留白，保留圆角与透明四角（浏览器不套系统圆角）。
for spec in \
  "32:favicon-32.png" \
  "32:favicon-32x32.png" \
  "180:favicon-180x180.png" \
  "180:apple-touch-icon.png" \
  "192:favicon-192.png" \
  "512:favicon-512x512.png" \
  "512:brandmark.png"; do
  size="${spec%%:*}"
  name="${spec#*:}"
  magick "$TMP/rounded.png" -filter Lanczos -resize "${size}x${size}!" "$PUB/$name"
done

# 5. brandmark.svg 是内嵌 base64 PNG 的包装，随 512 图标一起刷新。
python3 - "$PUB/brandmark.png" "$PUB/brandmark.svg" <<'PY'
import base64
import sys

png_path, svg_path = sys.argv[1], sys.argv[2]
data = base64.b64encode(open(png_path, "rb").read()).decode("ascii")
svg = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" '
    'width="512" height="512"><image href="data:image/png;base64,{}" '
    'width="512" height="512" preserveAspectRatio="xMidYMid meet"/></svg>\n'
).format(data)
open(svg_path, "w").write(svg)
PY

echo "已生成："
echo "  $ICONS/icon.icns        macOS 满幅不透明"
echo "  $PUB/*.png + brandmark.svg   网页圆角无留白"
echo "未改动：icon.ico / Square*Logo.png / StoreLogo.png / 32x32.png / 128x128*.png（Windows、Linux 资产）"
