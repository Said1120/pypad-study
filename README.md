# PyPad 学习台

PyPad 学习台是一款面向 Python 初学者的免费、开源 iPad PWA。它不要求登录，Python 与项目代码都在设备本地运行；首次联网打开并完成缓存后，可以离线编辑、保存和运行代码。

## 已实现

- 多项目、文件夹和多 `.py` 文件，支持项目内 `import`
- CodeMirror 编辑器、自动保存、字体与面板偏好记忆
- `⌘S` 保存、`⌘Enter` 运行、`⌘.` 停止、`⌘P` 快速打开、`⌘F` 查找
- Worker 内运行 Pyodide，实时输出、交互式 `input()`、死循环中断与崩溃恢复
- Matplotlib 图像输出，以及 NumPy、Matplotlib、pandas 离线包
- IndexedDB 本地存储和 ZIP 导入/导出备份
- 中文速查表与确定性的常见错误解释
- 横屏三栏与竖屏抽屉布局、PWA 离线启动和安全区域适配

## 本地开发

需要 Node.js 20.19+（推荐当前 LTS）和 npm。

```bash
npm ci
npm run dev
```

`npm run dev` 会从锁定的 Pyodide 版本准备同源运行资源。首次执行需要联网，生成的 `public/pyodide` 不提交到仓库。

常用命令：

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

端到端测试首次运行前需要浏览器：

```bash
npx playwright install chromium webkit
```

## 发布到 Cloudflare Pages

本项目没有执行任何账号连接或发布操作。得到仓库和 Cloudflare 账号授权后，可按以下配置接入：

- Framework preset：`Vite`
- Build command：`npm run build`
- Build output directory：`dist`
- Node.js：20.19 或更新的 LTS

`public/_headers` 会随构建发布，为 SharedArrayBuffer 设置 COOP/COEP，并禁止摄像头、麦克风和定位权限。每个 Pyodide 资源均小于 Cloudflare Pages 的单文件限制。主分支用于生产部署，其他分支可生成预览地址。

正式发布前必须完成 [真实 iPad 验收清单](docs/ipad-acceptance-checklist.md)。

## 产品边界

最低目标为 iPadOS 17。它不是 Jupyter、系统终端或完整桌面 Python：不支持任意原生 `pip` 扩展、后台服务、调试器、云同步和多人协作。Safari 可能在设备空间紧张时清理网站存储，因此 ZIP 导出是正式备份方式。

隐私承诺见 [PRIVACY.md](PRIVACY.md)。项目采用 [MIT License](LICENSE)。
