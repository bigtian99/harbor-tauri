# softwareLibrary 模板替换规则

## 模板信息
- **模板目录**: `softwareLibrary/`
- **模板类型**: softwareLibrary
- **用途**: 软件库应用落地页

## 替换规则

### 1. 标题 (title)
**占位符**: `<title>白鸽软件库 - 官方下载</title>`
**替换逻辑**: 整个 `<title>` 标签内容替换为 `<title>{新名称} - 官方下载</title>`

### 2. Logo 图片
**占位符**: `<img src="白鸽软件库.jpg" alt="白鸽软件库">`
**替换逻辑**: `src="白鸽软件库.jpg"` → `src="{新logoURL}"`

### 3. 应用名称
**占位符**: `<span>白鸽软件库</span>`
**替换逻辑**: 匹配 `>白鸽软件库</span>` 替换为新名称

### 4. APK 下载链接
**占位符**: `href="https://short.tiankongshuyu.cn/tksy/xxx"`
**替换逻辑**: 替换所有 `tiankongshuyu.cn` 域名下的下载链接

### 5. 二维码
**占位符**: 自动生成，基于下载链接
**替换逻辑**: 无需手动替换，JS 自动根据下载链接生成

## 数据来源

从 API 获取的 `SubChannelData` 字段：
| 字段 | 用途 | 示例 |
|------|------|------|
| `sub_channel_name` | 应用名称 | "白鸽软件库" |
| `sub_channel_logo` | Logo URL | "https://xxx.com/logo.png" |
| `sub_channel_link` | APK 下载链接 | "https://xxx.com/app.apk" |
| `type_code` | 模板类型 | "softwareLibrary" |

## 文件结构
```
softwareLibrary/
├── index.html          # 主模板文件
└── README.md           # 本文件
```

## 注意事项
1. Logo 图片使用中文文件名 `白鸽软件库.jpg` 作为占位符
2. APK 链接必须是完整的 https 链接
3. 模板会自动处理移动端响应式
