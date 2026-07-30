# 动漫落地页模板（三版都保留）

少年漫画开战页风格，三套视觉并存，渠道 `type_code` 以 `anime` 开头时均可匹配（与 `comic` / `comic-1` 同规则）。

| 目录 | 风格 | 一句话 |
|------|------|--------|
| `anime/` | A · 周刊开战页 | 纸白 + JUMP 红，冲击波 CTA |
| `anime-1/` | B · 墨点章扉 | 黑底网纹 + 朱印「連載中」 |
| `anime-2/` | C · 分镜爆炸 | 夜蓝 + 青粉，「BANG! / GO!!」 |

## 共同约定

| 占位符 | 替换为 |
|--------|--------|
| `{{NAME}}` | `sub_channel_name` |
| `{{LOGO}}` | `sub_channel_logo` |
| `{{DOWNLOAD_URL}}` | `sub_channel_link`（APK） |

- 分类 meta：必须在各目录 `index.html` 的 `<head>` 写入  
  `<meta name="template-category" content="动漫" />`  
  （管理页分组只认此 meta，不读 README；缺了会按目录名显示）
- 二维码：本地 `vendor/qrcode.min.js`，按下载链生成；附「点此下载 APK」
- 展示图：Pixabay 可商用二次元插画（见各目录 `ATTRIBUTION.md`）
- 下载按钮图：`image/Group6.png`（安卓）/ `Group7.png`（iOS）

## 本地预览

```bash
cd templates && python3 -m http.server 8765
# 打开 http://127.0.0.1:8765/anime-picker.html
```

也可在 JarPorter「落地页」里用 `type_code=anime` 生成后预览。
