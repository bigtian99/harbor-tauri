# anime-1 模板（版本 B · 墨点章扉）

> 与 `anime`、`anime-2` **一并保留**。总览见 [`../ANIME.md`](../ANIME.md)。

## 模板信息
- **模板目录**: `anime-1/`
- **模板类型**: anime-1
- **用途**: 动漫类应用落地页（墨点章扉 / 连载印）
- **模板分类**: 动漫

## 管理页分类（上传必读）

管理模板里的中文分组**只认** `index.html` 里的 meta，**不读**本 README：

```html
<meta name="template-category" content="动漫" />
```

上传 zip 时请把该标签放在 `<head>` 内。缺失时会按目录名显示，进不了「动漫」分组。`anime` / `anime-1` / `anime-2` 都要写相同 `content`。

## 视觉特征
- 深黑底 + 奶油字 + 警示黄点缀
- 网纹（screentone）+ 朱印「連載中」
- 左大图右文案章扉构图；本地二维码 + APK 链接

## 替换规则

| 占位符 | 替换为 |
|--------|--------|
| `{{NAME}}` | `sub_channel_name` |
| `{{LOGO}}` | `sub_channel_logo` |
| `{{DOWNLOAD_URL}}` | `sub_channel_link` |

本地对比：`templates/anime-picker.html`
