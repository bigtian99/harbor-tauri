# comic-3 模板替换规则

## 模板信息
- **模板目录**: `comic-3/`
- **模板类型**: comic
- **用途**: 漫画类应用落地页（赛博朋克/霓虹设计风格）
- **设计特点**: 霓虹灯光、网格背景、切角边框、科技感十足

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
- Hero: `<span class="highlight">漫蛙</span>` (在 `.hero-title` 中)
- Badge: `<span>SYSTEM ONLINE</span>`
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
comic-3/
├── index.html          # 主模板文件
├── image/
│   ├── logo.png        # Logo 图片
│   ├── Group610.png    # 首页展示图
│   └── slices/         # 轮播图图片
└── README.md           # 本文件
```

## 设计特点

### 与 comic 模板的区别
| 特性 | comic | comic-3 |
|------|-------|---------|
| 设计风格 | 经典深色 | 赛博朋克霓虹 |
| 字体 | 系统字体 | Orbitron 科技字体 |
| 配色 | 蓝色主调 | 粉+青+紫霓虹色 |
| 边框 | 圆角 | 切角设计 (clip-path) |
| 动画 | 基础 | 闪烁+旋转+脉冲 |
| 背景 | 纯色/图片 | 网格+渐变 |

### 视觉特效
1. **霓虹灯光** - 粉色、青色、紫色发光效果
2. **赛博网格** - 背景网格线
3. **切角边框** - clip-path 创建的科技感边框
4. **闪烁动画** - 标题霓虹灯闪烁效果
5. **旋转光效** - Hero 区域背景旋转渐变
6. **双向滚动** - 作品展示区双向无限滚动

### 颜色方案
- 主色: `#ff2d95` (霓虹粉)
- 辅色: `#00f5ff` (霓虹青)
- 强调: `#b026ff` (霓虹紫)

## 注意事项
1. Logo URL 必须是完整的 https 链接
2. APK 链接必须以 `.apk` 结尾
3. 模板会自动处理移动端响应式
4. 使用 Google Fonts (Orbitron)，需网络连接
5. 适合年轻用户群体，科技感强烈
