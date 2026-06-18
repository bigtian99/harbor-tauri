# comic-2 模板替换规则

## 模板信息
- **模板目录**: `comic-2/`
- **模板类型**: comic
- **用途**: 漫画类应用落地页（现代渐变设计风格）
- **设计特点**: 渐变背景、卡片布局、动画效果、沉浸式体验

## 替换规则

### 1. 标题 (title)
**占位符**: `<title>漫蛙 - 官方下载</title>`
**替换逻辑**: 整个 `<title>` 标签内容替换为 `<title>{新名称} - 官方下载</title>`

### 2. Logo 图片
**占位符**: `<img src="./image/logo.png">`
**替换逻辑**: `src="./image/logo.png"` → `src="{新logoURL}"`

### 3. 应用名称
**占位符**:
- Header: `<span>漫蛙</span>` (在 `.header-title` 中)
- Hero: `<span>漫蛙</span>` (在 `.hero-title` 中)
- Badge: `<span>官方正版 · 安全下载</span>`
- Footer: `<div class="footer-logo">漫蛙</div>`

**替换逻辑**: 匹配 `>漫蛙</span>` 或 `<span>漫蛙</span>` 替换为新名称

### 4. APK 下载链接
**占位符**: `var androidDownloadUrl = "https://comic-short.tiankongshuyu.cn/tksy/xxx.apk"`
**替换逻辑**: 替换所有包含 `.apk` 的 https 链接

### 5. 二维码
**占位符**: 自动生成，基于 `androidDownloadUrl`
**替换逻辑**: 无需手动替换，JS 自动根据下载链接生成

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
1. Logo URL 必须是完整的 https 链接
2. APK 链接必须以 `.apk` 结尾
3. 模板会自动处理移动端响应式
4. 使用 CSS 动画，无需额外依赖
