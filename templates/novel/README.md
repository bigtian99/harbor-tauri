# novel 模板替换规则

## 模板信息
- **模板目录**: `novel/`
- **模板类型**: novel
- **用途**: 小说阅读应用落地页

## 替换规则

### 1. 标题 (title)
**占位符**: `<title>笔书阁</title>`
**替换逻辑**: 整个 `<title>` 标签内容替换为 `<title>{新名称}</title>`

### 2. Logo 图片
**占位符**: `background-image: url('./image/logo.png')`
**替换逻辑**: CSS 中的 logo 路径会被替换

### 3. 应用名称
**占位符**: `<span>笔书阁</span>`
**替换逻辑**: 匹配 `>笔书阁</span>` 或 `<span>笔书阁</span>` 替换为新名称

### 4. APK 下载链接
**占位符**: `var androidDownloadUrl = "https://xxx.apk"`
**替换逻辑**: 替换所有包含 `.apk` 的 https 链接

### 5. 二维码
**占位符**: 自动生成，基于 `androidDownloadUrl`
**替换逻辑**: 无需手动替换，JS 自动根据下载链接生成

## 数据来源

从 API 获取的 `SubChannelData` 字段：
| 字段 | 用途 | 示例 |
|------|------|------|
| `sub_channel_name` | 应用名称 | "笔书阁" |
| `sub_channel_logo` | Logo URL | "https://xxx.com/logo.png" |
| `sub_channel_link` | APK 下载链接 | "https://xxx.com/app.apk" |
| `type_code` | 模板类型 | "novel" |

## 文件结构
```
novel/
├── index.html          # 主模板文件
├── image/
│   └── logo.png        # Logo 图片
└── README.md           # 本文件
```

## 注意事项
1. Logo 使用 CSS background-image 展示
2. APK 链接必须以 `.apk` 结尾
3. 模板会自动处理移动端响应式
