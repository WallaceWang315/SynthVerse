# P0 Windows 开发环境检查

检查日期：2026-09-27  
检查范围：P0-02 所需的 Git、CMake、C++/Visual Studio 工具、Python，以及当前仓库内的 Vital 源码与构建配置。此次检查只执行本机只读探测，未安装或下载软件，未修改 PATH，也未运行构建。

## 结论

当前环境尚不能直接构建 Windows C++ 项目。Git 和 Python 可用；Visual Studio 2019 Build Tools 与 MSBuild 已安装，但未检测到 MSVC C++ x64/x86 工具组件或 Windows 10 SDK；CMake 未在 PATH 或检查过的标准位置发现。当前目录没有 Vital 源码、CMake 配置或构建脚本，且不是 Git 工作树。

## 检测结果

| 项目 | 实际结果 | 状态 |
| --- | --- | --- |
| Windows | `Microsoft Windows NT 10.0.22631.0` | 已确认 |
| Git | `git version 2.41.0.windows.3`；命令路径 `D:\Git\bin\git.exe` | 可用 |
| CMake | `cmake` 不在 PATH；未发现 `C:\Program Files\CMake\bin\cmake.exe`；VS 2019 Build Tools 的常见内置 CMake 路径也不存在 | 缺失或未安装到已检查位置 |
| Python | `Python 3.12.4`；命令路径 `I:\Anaconda\python.exe` | 可用 |
| Python launcher | `py` 不在 PATH | 非阻塞；可直接使用 `python` |
| Visual Studio | `vswhere` 在标准位置可用，检测到 Visual Studio 生成工具 2019 `16.11.34`，安装完整且可启动 | Build Tools 本体已确认 |
| MSBuild | `16.11.2.50704`；可执行文件位于 VS 2019 Build Tools 安装目录，但不在当前 PATH | 可用，但不能替代缺失的 C++ 编译器 |
| MSVC C++ 工具 | `cl` 不在 PATH；`vswhere -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64` 无结果；VS 安装目录下不存在 `VC\Tools\MSVC` | 未安装/不可用 |
| Windows SDK | 标准目录 `C:\Program Files (x86)\Windows Kits\10\Include` 与 `Lib` 均不存在 | 未检测到 |
| Ninja | `ninja` 不在 PATH | 未检测到；若使用 Visual Studio CMake 生成器则不是必需项 |

`cl` 不在普通终端 PATH 本身不能证明 Visual Studio 未安装。本次已进一步使用标准 `vswhere` 位置与 VS 安装目录验证：Build Tools 确实存在，但 C++ 工具组件查询无结果，且 `VC\Tools\MSVC` 目录不存在，因此可判定当前 VS 实例不具备所需 MSVC 工具链。

## 仓库状态

- `D:\Repos\SynthVerse` 当前仅包含 `docs\development-plan.md` 与 `docs\agent-workflow.md`（本报告写入前）。
- `rg --files` 未发现 `CMakeLists.txt`、`CMakePresets.json`、`*.cmake` 或名称含 `Vital`/`vital` 的文件。
- `git status` 返回“not a git repository”；当前目录没有可识别的 Git 元数据。
- 因此尚无法确认或固定 Vital 源码提交，也无法配置、生成或编译项目。

## 缺口与最小后续动作

1. 通过现有 Visual Studio Installer 为 VS 2019 Build Tools 添加 C++ 桌面构建能力，至少包含 MSVC x64/x86 编译工具和匹配的 Windows 10 SDK。若 Vital 或后续 JUCE 依赖要求更新的工具集，再统一升级到团队选定的 VS 版本。
2. 安装项目选定版本的 CMake，并确保新终端可执行 `cmake --version`。只有项目明确采用 Ninja 时才需要另行补齐 Ninja。
3. 将 SynthVerse 初始化为 Git 工作树或检出正式仓库，再按许可决策引入并固定 Vital 源码提交。
4. 在仓库中加入最小 `CMakeLists.txt`/preset 与可重复构建说明后，重新运行环境检查，再执行小型配置或编译冒烟测试。

以上动作完成后的最低复核命令应覆盖 `git --version`、`cmake --version`、开发者命令提示符中的 `cl`、Windows SDK 目录，以及仓库中的 Vital 提交和 CMake 入口文件。
