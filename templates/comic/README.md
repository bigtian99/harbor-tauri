# comic 模板替换规则

## 模板信息
- **模板目录**: `comic/`
- **模板类型**: comic
- **用途**: 漫画类应用落地页

## 替换规则

### 1. 标题 (title)
**占位符**: `<title>漫蛙 - 官方下载</title>`
**替换逻辑**: 整个 `<title>` 标签内容替换为 `<title>{新名称} - 官方下载</title>`

### 2. Logo 图片
**占位符**: `<img src="./image/logo.png">`
**替换逻辑**: `src="./image/logo.png"` → `src="{新logoURL}"`

### 3. 应用名称
**占位符**: `<span>漫蛙</span>`
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
comic/
├── index.html          # 主模板文件
├── image/
│   ├── logo.png        # Logo 图片
│   ├── Group6.png      # Android 下载按钮
│   ├── Group7.png      # iOS 下载按钮
│   ├── Group610.png    # 首页展示图
│   ├── Group612.png    # 产品介绍图
│   ├── Group34.png     # 背景图
│   └── slices/         # 轮播图图片
└── README.md           # 本文件
```

## 注意事项
1. Logo URL 必须是完整的 https 链接
2. APK 链接必须以 `.apk` 结尾
3. 模板会自动处理移动端响应式
