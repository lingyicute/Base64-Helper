# Base64-Helper

H5 Base64 Decoder & Encoder — 单文件、纯前端、数据不离开浏览器。

## 功能

- 文本 ⇄ Base64（UTF-8），支持 URL 安全、无填充、76 列 MIME 换行
- 文件 → Base64（可输出 Data URI），Base64 / Data URI → 文件（自动探测类型并预览）
- 智能解码：自动识别 Data URI（含百分号编码形式）、URL 安全字符、空白与缺失的填充
- 大数据在本地 Blob Worker 中处理，不阻塞界面
- Material You 风格动态主题色，深色 / 浅色 / 跟随系统
- 通过内置 CSP（`connect-src 'none'`）与 `no-referrer` 策略，从浏览器层面禁止页面发起网络请求，确保数据只在本地处理
- 文件类型探测覆盖常见图片、音视频、压缩包、字体、WebAssembly 等格式
- 超过 20 万字符的结果仅在文本框中预览前 20 万字符，复制与下载始终使用完整内容
- 支持拖拽文件到页面任意位置，以及键盘操作（方向键切换分段按钮与标签页，Esc 关闭主题面板）

## 使用

直接用浏览器打开 `index.html` 即可，无需构建，也不依赖任何外部脚本。

需要现代浏览器（支持 `TextEncoder`、`Blob`、`FileReader`、CSS `color-mix()`）；Blob Worker 不可用时会自动回退到主线程处理。

## 许可

[AGPL-3.0](LICENSE)
