# Base64-Helper

H5 Base64 Decoder & Encoder — 单文件、纯前端、数据不离开浏览器。

## 功能

- 文本 ⇄ Base64（UTF-8），支持 URL 安全、无填充、76 列 MIME 换行
- 文件 → Base64（可输出 Data URI），Base64 / Data URI → 文件（自动探测类型并预览）
- 智能解码：自动识别 Data URI（含百分号编码形式，`base64` 标记可在任意参数位置）、PEM 封装（`-----BEGIN …`，块前后的说明文字与 PGP 装甲的 CRC 行会被忽略）、URL 安全字符、外层引号、空白与缺失的填充
- 解码文件时以 Data URI 声明的类型修正容器格式的扩展名（docx / xlsx / epub / apk / odt 不再被保存成 zip，m4a、webm / ogg 音频同理）
- 下载文件名会自动去除非法字符，并避开 Windows 保留设备名（如 `CON`、`NUL`）
- 大数据在本地 Blob Worker 中处理，不阻塞界面
- Material You 风格动态主题色，深色 / 浅色 / 跟随系统
- 通过内置 CSP（`connect-src 'none'`）与 `no-referrer` 策略，从浏览器层面禁止页面发起网络请求，确保数据只在本地处理
- 文件类型探测覆盖常见图片、音视频、压缩包、字体、可执行文件、WebAssembly 等格式
- 超过 20 万字符的结果仅在文本框中预览前 20 万字符，复制与下载始终使用完整内容
- 支持拖拽文件到页面任意位置，以及键盘操作（方向键切换分段按钮与标签页，Esc 关闭主题面板）

## 使用

直接用浏览器打开 `index.html` 即可，无需构建，也不依赖任何外部脚本。

需要现代浏览器（支持 `TextEncoder`、`Blob`、`FileReader`、CSS `color-mix()`）；Blob Worker 不可用时会自动回退到主线程处理。

## 限制

浏览器的字符串长度上限约为 2^29 个字符，因此「文件 → Base64」最大约 380 MB，「Base64 文件 → 文件」最大约 500 MB，超过时会给出明确提示。

## 测试

核心函数（编解码、Data URI、PEM、类型探测等）带有基于 Node 内置测试框架的单元测试，直接从 `index.html` 中提取代码运行，无需安装任何依赖：

```sh
node --test   # 或 npm test
```

测试同样会在隔离上下文中运行 Blob Worker 的源码，确保后台线程与主线程行为一致；GitHub Actions 会在 Node 20 / 22 上自动执行。

## 许可

[AGPL-3.0](LICENSE)
