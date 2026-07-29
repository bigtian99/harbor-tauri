# anime 模板（版本 A · 周刊开战页）

> 与 `anime-1`、`anime-2` **一并保留**。总览见 [`../ANIME.md`](../ANIME.md)。

## 模板信息
- **模板目录**: `anime/`
- **模板类型**: anime
- **用途**: 动漫类应用落地页（少年周刊开战页）
- **模板分类**: 动漫

## 视觉特征
- 纸白底 + 墨黑 + JUMP 红
- 斜切分镜 Hero + 「ドン！！」音效字
- 冲击波环绕下载区；本地二维码 + APK 链接

## 替换规则

| 占位符 | 替换为 |
|--------|--------|
| `{{NAME}}` | `sub_channel_name` |
| `{{LOGO}}` | `sub_channel_logo` |
| `{{DOWNLOAD_URL}}` | `sub_channel_link` |

## 文件结构
```
anime/
├── index.html
├── vendor/qrcode.min.js
├── image/          # Pixabay 二次元插画 + 下载按钮
├── ATTRIBUTION.md
└── README.md
```

本地对比：`templates/anime-picker.html`
