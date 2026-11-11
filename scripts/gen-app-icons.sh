#!/usr/bin/env bash
# 从设计稿 app-icon.png 生成各平台图标资产。
#
# macOS 与其它平台规格不同，不能混用：
#   macOS（icon.icns）：必须是「满幅、不透明、无自带圆角」的 1024 方形。
#     实测（macOS 26/27）：留透明边距的旧式图标会被系统判定为 legacy，
#     外面自动补一层玻璃/浅色圆角背板，图标被缩到中间——就是 Dock / Finder 里
#     看到的「双层边框」。做法：设计稿铺满画布后，把四角透明区合成到一条与
#     设计稿背景一致的竖直渐变上，再交不透明 PNG 给 iconutil。
#     设计稿自带的圆角会被系统 squircle 掩膜盖掉，不会再出现第二条边。
#   Windows / Linux / 网页：系统不替图标套圆角，必须保留自带的圆角与透明角。
#
# 因此不要用 `pnpm tauri icon` 全量重生成：它会用同一套规则覆盖两个平台，
# 让 Windows 图标变成直角方块。改动设计稿后只需重跑本脚本。
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

# 2. macOS 母版：设计稿铺满画布，四角透明区用「与背景同色的竖直渐变」补满，
#    得到不透明、无透明边距的满幅方形（原因见文件头）。
#    渐变端点取自设计稿左右边缘背景（顶部 #0d3a6b → 底部 #04162e）。
magick -size 1024x1024 gradient:'#0d3a6b'-'#04162e' "$TMP/mac_bg.png"
magick "$TMP/mac_bg.png" "$TMP/rounded.png" -composite -alpha off "$TMP/macos.png"

# 2.1 校验：必须是满幅且无 alpha，否则 macOS 又会把图标套进背板
OPAQUE="$(magick "$TMP/macos.png" -format '%@' info:)"
ALPHA="$(magick "$TMP/macos.png" -format '%A' info:)"
case "$OPAQUE" in
  1024x1024+0+0) ;;
  *)
    echo "✗ macOS 母版不是满幅（$OPAQUE），Dock 会被套玻璃背板，请检查第 2 步" >&2
    exit 1
    ;;
esac
if [ "$ALPHA" = "Blend" ] || [ "$ALPHA" = "Yes" ]; then
  echo "✗ macOS 母版仍带 alpha（$ALPHA），会被判定为 legacy 图标并补背板" >&2
  exit 1
fi
echo "macOS 母版: 满幅 1024 不透明（$OPAQUE）"

# 3. 用 iconset 生成 icon.icns（iconutil 会补齐 16/32 的 legacy 条目与 mask）。
ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 64 128 256 512 1024; do
  # PNG24：强制不带 alpha，16px 下也不会被量化成调色板（iconutil 会判非法）
  magick "$TMP/macos.png" -filter Lanczos -resize "${s}x${s}!" "PNG24:$ICONSET/_${s}.png"
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
echo "  $ICONS/icon.icns        macOS 满幅不透明（系统套 squircle）"
echo "  $PUB/*.png + brandmark.svg   网页圆角无留白"
echo "未改动：icon.ico / Square*Logo.png / StoreLogo.png / 32x32.png / 128x128*.png（Windows、Linux 资产）"
