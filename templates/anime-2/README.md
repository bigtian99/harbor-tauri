# anime-2 模板（版本 C · 分镜爆炸）

> 与 `anime`、`anime-1` **一并保留**。总览见 [`../ANIME.md`](../ANIME.md)。

## 模板信息
- **模板目录**: `anime-2/`
- **模板类型**: anime-2
- **用途**: 动漫类应用落地页（分镜爆炸 / 电光音效）
- **模板分类**: 动漫

## 管理页分类（上传必读）

管理模板里的中文分组**只认** `index.html` 里的 meta，**不读**本 README：

```html
<meta name="template-category" content="动漫" />
```

上传 zip 时请把该标签放在 `<head>` 内。缺失时会按目录名显示，进不了「动漫」分组。`anime` / `anime-1` / `anime-2` 都要写相同 `content`。

## 视觉特征
- 夜蓝底 + 电光青 + 品红
- 不规则分镜网格 + 「BANG! / GO!!」
- 速度线氛围与封面冲刺跑马灯；本地二维码 + APK 链接

## 替换规则

| 占位符 | 替换为 |
|--------|--------|
| `{{NAME}}` | `sub_channel_name` |
| `{{LOGO}}` | `sub_channel_logo` |
| `{{DOWNLOAD_URL}}` | `sub_channel_link` |

本地对比：`templates/anime-picker.html`
