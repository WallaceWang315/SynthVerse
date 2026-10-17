# Windows 便携应用

## 给使用者

1. 将 `SynthVerse-0.1.1-Windows-x64-portable.exe` 放入可写目录，例如个人文件夹或移动硬盘。双击启动，不需要安装 Node.js、Python 或本地开发环境。
2. 点击左侧“模型设置”。填写 API 基础地址（也接受完整 `/chat/completions` 地址）、模型名称和自己的 API Key。支持兼容 Chat Completions 且支持 Function Calling 的云模型与本机服务。
3. 点击“测试连接”，检查接口能否返回工具调用。测试会发出一次小型模型请求，可能产生服务商费用，不会发送音乐工程，也不会自动保存。
4. 点击“保存并使用”，新对话立即使用该配置。清除配置后回到本地规则演示。无需模型即可手动编辑、试听和导出音乐。

示例：DeepSeek 基础地址 `https://api.deepseek.com/v1`，模型名按服务商提供的 ID 填写；Ollama 基础地址 `http://127.0.0.1:11434/v1`，模型名填写已安装且支持工具调用的模型。应用不附带模型权重，也不会替你安装或启动本机模型服务。

## 数据与迁移

- 应用首次运行会在 EXE 旁创建 `SynthVerse-data`，包含工程、收藏、偏好和连接设置。复制或移动前先退出应用，将 EXE 与该目录一起带走。
- API Key 经 Windows 当前账户的加密服务处理后落盘，不包含在音乐工程导出中；设置接口只返回“是否已保存 Key”，不回传原文。更换电脑或账户后通常需要重新填写 Key。[Electron safeStorage 文档](https://www.electronjs.org/docs/latest/api/safe-storage)
- 不要向其他人分发个人的 `SynthVerse-data`；分发干净 EXE 即可。工程仍可通过应用的 JSON 导出/导入迁移，原浏览器中的工程不会自动搬入桌面版。
- 留空 Key 会保留同一接口的已存 Key；切换接口地址时不会将旧 Key 发给新服务。可勾选“清除已保存的 Key”，或点击“清除配置”。
- 当前发布的是 Windows x64 免安装版，尚未进行 Windows 代码签名。其他系统需要分别构建和验证，不能直接运行该 EXE。

## 开发与重新打包

```powershell
npm.cmd ci
npm.cmd run desktop:dev
npm.cmd run desktop:pack
npm.cmd run test:desktop
node scripts/test-portable.mjs
```

`desktop:pack` 构建前端、打包本地网关与主进程，并使用 electron-builder 的 [portable 目标](https://www.electron.build/docs/win/) 输出 `release/`。首次需要下载 Electron 和打包工具。`test:desktop` 使用同次构建的 `release/win-unpacked/SynthVerse.exe` 和本地假模型验证启动、加密配置、工具调用、候选应用、重启持久化及密钥清除；不使用真实 Key 或云模型。`test-portable.mjs` 将最终 EXE 复制到独立测试目录，验证自解压启动、干净的设置及默认便携数据目录。

包内白名单仅包括构建后的界面、主进程及包描述，不包含项目 `.env`、源码目录下的 Vital、开发工作区或个人数据。应用通过固定的 `synthverse://app` 页面来源保存工程，本地网关使用随机回环端口和每次启动生成的会话凭证；换端口不影响工程恢复。

网页版同样提供设置表单，但设置默认只在网关进程内存中保留；退出服务后恢复环境变量配置。需要跨次运行保存时使用桌面版。桌面版不读取开发者的 `.env`。

主要文件：`desktop/main.ts`、`services/api/model-settings.ts`、`src/ModelSettings.tsx`、`electron-builder.json`。
