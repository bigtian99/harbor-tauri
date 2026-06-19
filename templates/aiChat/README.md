# aiChat 模板替换规则

## 模板信息
- **模板目录**: `aiChat/`
- **模板类型**: aiChat
- **用途**: AI 聊天应用落地页

## 替换规则

模板内使用占位符，生成时由 `render_template` 一次性替换（见 `src-tauri/src/landing.rs`）：

| 占位符 | 替换为 | 出现位置 |
|--------|--------|----------|
| `{{NAME}}` | `sub_channel_name` | `<title>`、导航、标题、alt 等所有名称处 |
| `{{LOGO}}` | `sub_channel_logo` | `<img src>` / `background-image: url()` |
| `{{DOWNLOAD_URL}}` | `sub_channel_link` | 下载按钮、`androidDownloadUrl` 等 apk 链接 |

二维码由模板 JS 基于渲染后的下载链接自动生成，无需手动处理。

## 数据来源

从 API 获取的 `SubChannelData` 字段：
| 字段 | 用途 | 示例 |
|------|------|------|
| `sub_channel_name` | 应用名称 | "Tofai" |
| `sub_channel_logo` | Logo URL | "https://xxx.com/logo.png" |
| `sub_channel_link` | APK 下载链接 | "https://xxx.com/app.apk" |
| `type_code` | 模板类型 | "aiChat" |

## 文件结构
```
aiChat/
├── index.html          # 主模板文件
└── README.md           # 本文件
```

## 注意事项
1. `{{LOGO}}` 渲染为完整 https URL
2. `{{DOWNLOAD_URL}}` 渲染为 .apk 下载链接
3. 模板自动处理移动端响应式
