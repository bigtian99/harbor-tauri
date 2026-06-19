# comic-2 模板替换规则

## 模板信息
- **模板目录**: `comic-2/`
- **模板类型**: comic
- **用途**: 漫画类应用落地页（现代渐变设计风格）
- **设计特点**: 渐变背景、卡片布局、动画效果、沉浸式体验

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
| `sub_channel_name` | 应用名称 | "漫蛙" |
| `sub_channel_logo` | Logo URL | "https://xxx.com/logo.png" |
| `sub_channel_link` | APK 下载链接 | "https://xxx.com/app.apk" |
| `type_code` | 模板类型 | "comic" |

## 文件结构
```
comic-2/
├── index.html          # 主模板文件
├── image/
│   ├── logo.png        # Logo 图片
│   ├── Group610.png    # 首页展示图
│   └── slices/         # 轮播图图片
└── README.md           # 本文件
```

## 设计特点

### 与 comic 模板的区别
| 特性 | comic | comic-2 |
|------|-------|---------|
| 设计风格 | 经典深色 | 现代渐变 |
| 布局 | 传统三栏 | Hero + 卡片网格 |
| 动画效果 | 基础 | 脉冲动画 + 滚动动画 |
| 背景 | 纯色 | 渐变 + 模糊效果 |
| 按钮 | 图片按钮 | 渐变按钮 + SVG图标 |
| 轮播 | 双向滚动 | 单向无限滚动 |

### 视觉特效
1. **渐变背景** - 多层径向渐变，营造深度感
2. **脉冲动画** - Hero 区域背景光效
3. **悬浮效果** - 卡片悬停上浮 + 边框发光
4. **无限滚动** - 作品展示区自动滚动

## 注意事项
1. `{{LOGO}}` 渲染为完整 https URL
2. `{{DOWNLOAD_URL}}` 渲染为 .apk 下载链接
3. 模板自动处理移动端响应式
