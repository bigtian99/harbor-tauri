# comic-3 模板替换规则

## 模板信息
- **模板目录**: `comic-3/`
- **模板类型**: comic
- **用途**: 漫画类应用落地页（赛博朋克/霓虹设计风格）
- **模板分类**: 漫画
- **设计特点**: 霓虹灯光、网格背景、切角边框、科技感十足

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
1. `{{LOGO}}` 渲染为完整 https URL
2. `{{DOWNLOAD_URL}}` 渲染为 .apk 下载链接
3. 模板自动处理移动端响应式
