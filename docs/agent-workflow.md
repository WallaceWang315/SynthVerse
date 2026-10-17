# 小型任务子代理工作约定

配置日期：2026-09-27。三个代理均为用户级可复用角色，模型 `gpt-5.6-sol`，推理强度 `medium`。角色文件存放于 `C:/Users/Wallace/.codex/agents/`，并非持续运行的后台服务。

| 角色 | 全局配置文件 | 职责 | 本轮唯一产物 |
| --- | --- | --- | --- |
| small_impl | `C:/Users/Wallace/.codex/agents/small_impl.toml` | 小型实现、脚本、局部修复或指定技术调查 | `docs/p0/environment-check.md` |
| small_verify | `C:/Users/Wallace/.codex/agents/small_verify.toml` | 局部验证、回归核查、验收证据 | `docs/p0/acceptance-checklist.md` |
| small_docs | `C:/Users/Wallace/.codex/agents/small_docs.toml` | 文档整理、任务卡、接口说明 | `docs/p0/task-cards.md` |

## 公共行为

- 一次承接一个目标明确的小任务，只修改分配文件，保留其他人的改动。
- 定向读取、独立执行，避免扩大架构、无关重构和额外依赖。
- 子代理配置设定 `agents.enabled = false`，指令也禁止继续委派。
- 在可行时做最小充分验证；不能验证时说明限制，不能把计划写成测试通过。
- 达到验收条件后结束，简洁报告结果、绝对文件路径、验证与注意事项。
- 权限继承父任务；文件所有权由任务约束管理，不是操作系统级的逐文件隔离。

## 委派模板

```text
目标：一个可独立验收的结果。
输入：必要的文件、上下文和已确定约束。
允许修改：明确的文件列表。
排除项：不能触及的实现、环境、依赖和外部操作。
验收：需要执行的最小检查及结果格式。
阻塞处理：报告原因与已完成成果，不自行扩大范围。
```

主代理负责拆分互不冲突的文件范围、处理跨任务依赖、复核产物及汇总结果。跨任务问题由主代理协调，避免子代理修改对方文件。

## 本轮执行与验证边界

全局文件已通过 Python `tomllib` 语法解析和模型、推理强度、必需字段断言。全局 `config.toml` 同时用 `[agents.small_impl]` 等三个表登记描述及角色文件路径；与备份进行解析后比较，确认其他配置未改变。本轮协作工具不暴露命名角色选择参数，因此启动时显式指定相同模型和推理强度，并要求各子代理先读取对应全局角色文件。不能据此声称验证了桌面端对新增命名角色的热加载。

尝试 `codex --strict-config features list` 时，CLI 表示该子命令不支持 `--strict-config`；该命令不计为配置验证通过。普通 `codex features list` 成功加载配置。`codex debug prompt-input` 未显示角色名，不将其视为角色发现的成功证据。

本轮仅执行 P0 的环境检查和准备文档，不代表已完成 Vital 构建、Serum 兼容实验或 G0 验收。主代理默认模型及其他原有设置保持不变。全局主配置备份：`C:/Users/Wallace/.codex/config.toml.before-small-agents-20260927-162827.bak`。

参考：OpenAI Docs [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) 说明个人角色文件位置与配置字段。
