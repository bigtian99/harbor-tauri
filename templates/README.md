# 落地页模板说明

## 上传 zip 约定

1. zip 根下是模板目录（如 `aiChat-1/index.html`），不要多包一层「归档」。
2. 目录名决定渠道匹配：`type_code` 同名或 `{type_code}-数字`（如 `aiChat`、`aiChat-1`）。
3. **管理页中文分类只认 `index.html` 的 meta，不读 README**（上传时 README 还会被跳过）：

```html
<meta name="template-category" content="AI聊天" />
```

| 目录前缀 | 建议 content |
|----------|--------------|
| `aiChat` | AI聊天 |
| `comic` | 漫画 |
| `novel` | 小说 |
| `anime` | 动漫 |
| `videoShortPlay` | 短剧 |
| `gameLibraryAds` | 游戏库 |
| `softwareLibrary` | 软件库 |
| `vpn` | VPN |

缺 meta 时会按目录名去掉 `-数字` 后显示（如 `aiChat`），进不了对应中文分组。

## 占位符

| 占位符 | 含义 |
|--------|------|
| `{{NAME}}` | 应用名 |
| `{{LOGO}}` | Logo URL |
| `{{DOWNLOAD_URL}}` | APK 下载链接 |
