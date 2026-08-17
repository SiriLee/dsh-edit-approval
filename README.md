# dsh-edit-approval

DeepSeek Harness 插件：**编辑前审批**——`write` / `edit` / `str-replace-editor` 执行前显示**红绿行级 diff**（Claude Code 行为），用户选择：**同意 / 拒绝 / 对本命令总是同意**；可随时关闭（用户开关）。

> 状态：需求设计阶段（v0.1.0，未实现）。交互以 Claude Code 的 edit approval 为参考，并贴合 dsh Web 实际 UI（复用现有审批面板与 DOM 锚点，纯插件、不改仓库核心）。

## 背景与定位

社区编辑审查类插件是**事后**路线（[`dsh-change-review`](https://github.com/cirelir/dsh-change-review) 跟踪并渲染 diff、可回滚，但不拦截执行）；审批类插件（[`dsh-smart-approval`](https://github.com/TingRuDeng/dsh-smart-approval)、[`dsh-auto-approval-plugin`](https://github.com/StyxNether/dsh-auto-approval-plugin)）调整的是审批**模式/权限档位**，不针对单个编辑。「编辑前逐 diff 审批 + 总是允许」在社区是空白。

## 交互设计（Claude Code 参考）

### 1. 每次编辑前：红绿 diff + 三选一

Agent 调用 `write` / `edit` / `str-replace-editor` 时，**不直接落盘**，先弹出审批面板：

- 面板头部：工具名 + 目标文件（如 `write · src/foo.ts`）；
- 主体：**红绿行级 diff**（新增行绿、删除行红、上下文灰），与 Claude Code 的 edit approval 一致；
- 操作三选一：
  - **同意**（允许一次）——本次编辑执行
  - **拒绝**——本次编辑不执行，模型收到「用户拒绝了 write」反馈，可自行调整
  - **对本命令总是同意**——本次执行，且该工具加入「始终允许名单」，以后不再询问（可随时移除）

### 2. 用户开关

- 总开关（`enabled`）：随时开启/关闭整个插件（关闭后编辑直接执行，无审批）；
- 设置方式：设置页开关（优先）+ 命令 `/approval-edit on|off`（辅助）；
- 名单管理：`/approval-always <tool>`（添加）、`/approval-always list`、`/approval-always clear`（或设置页可视化编辑）。

### 3. 与既有权限体系的关系

- 插件只对已进入 `tools/pre-execute` 的写类工具生效；`ctx.approval` 会话策略（`ask`/`never`）照常生效——预设为 `danger-full-access`（`never`）时确定性拒绝，插件行为与权限预设联动，不绕过任何既有决策。
- 不改变沙箱模式；`read-only` 预设下写操作本就失败，插件不额外拦截。

## 机制（host 端，全部公开 API）

### 4. 拦截与审批路由

- 监听 `tools/pre-execute`（waterfall seam），匹配白名单工具。
- 执行前读取目标文件当前内容，与工具参数新内容计算**行级 diff**（新增/删除/上下文），格式化为多行文本。
- 返回 `{ kind: 'ask', reason: '<工具名与文件> \n <diff 文本>' }`：harness 内部 `serviceAsk` 自动调用 `ctx.approval.request(...)` 并把 `reason` 路由到 Web 审批面板 headline（已验证 `ApprovalPanel.tsx` headline 渲染 reason、无长度上限、body 可滚动）——**host 端零 UI 改动**。
- `allowed-once` → 工具继续；`rejected` → 工具 deny（不执行）。

### 5. 「总是允许」名单

- host 端维护「始终允许名单」（内存 + 可持久化）；`tools/pre-execute` 先查名单，命中则直接 `{ kind: 'allow' }`，不打扰。
- 名单写入入口：命令 `/approval-always <tool>`（host 端注册，公开 `ctx.commands`）。

## 客户端实现要点（纯插件，无源码补丁）

- 「总是允许」第三按钮：注入到现有审批面板 `[data-approval-key]` 容器内的操作行（与「拒绝/允许一次」并排）。
- 点击「总是允许」= 两步：①模拟点击面板既有「允许一次」按钮（本次放行）；②经 `session.command('/approval-always <tool>')` 把工具加入名单（工具名从运行时 `session.getSnapshot().pending` 中按 `data-approval-key` 匹配到的 approval payload 的 `toolName` 获取）。
- 面板元素定位用稳定属性锚点；无新页面、无新弹窗。

## 配置项（`Config`，经 profile patch 调整）

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关（用户可关） |
| `tools` | `['write','edit','str-replace-editor']` | 拦截白名单 |
| `minDiffLines` | `0` | 变更行数低于此值不询问（放行小改动） |
| `includeCreate` | `true` | 新建文件是否询问 |
| `includeDelete` | `true` | 清空/删除是否询问 |

## 边界与已知限制

- 只拦截写类**工具**；bash/pwsh 命令内的文件修改不在本期范围。
- diff 以文本形式呈现在审批面板（红绿行标记），非交互式逐行选择；「部分应用」不做。
- 「总是允许」名单默认内存态，重启失效；持久化（settings/storage）为可选增强。

## 明确不包含（本期）

- 编辑**后**审查/回滚面板——社区已有（`dsh-change-review`）。
- 快捷键（enter 审批 / esc 拒绝等）——独立快捷键插件，二期。
- 权限档位扩展（中间权限层）——社区已有（`dsh-auto-approval-plugin`）。

## 安装（预期）

```sh
dsh plugin --profile web add /home/slev/workspace/projects/dsh-edit-approval
```

包声明 `dsh.bundle` + `dsh.client`（host 拦截逻辑 + 浏览器「总是允许」按钮），可发布 GitHub 并打 `dsh-plugin` topic。

## 目录结构（预期）

```
src/index.ts       host 插件：tools/pre-execute 拦截 + /approval-always 命令 + Config
src/diff.ts        行级 diff 文本生成（纯函数）
src/guard.ts       拦截决策逻辑（工具匹配、阈值、名单、ask/放行判定，纯函数）
src/client/index.ts client 插件：「总是允许」按钮注入
tests/             纯函数单测（diff、guard）
cordis.patch.yml   bundle patch
package.json       dsh.bundle + dsh.client 声明、peerDependencies(@deepseek-ai/*)
```

## 依赖的公开 API

- `@deepseek-ai/dsh-tools`：`tools/pre-execute` 事件、`PreToolDecision`、`ToolExecution`
- `@deepseek-ai/dsh-user-approval`：`ctx.approval`（由 `{kind:'ask'}` 自动路由）
- `@deepseek-ai/dsh-commands`：`/approval-always` 命令注册
- 客户端：`@deepseek-ai/dsh-client-runtime/client`（`session.command`、`session.getSnapshot().pending`）

## 参考：deepseek-harness 接口文档

本地 fork：`../../oss/deepseek-harness/` · 官方仓库：[github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)

### 子系统文档（`docs/subsystems/`）

- [approval.md](../../oss/deepseek-harness/docs/subsystems/approval.md) — `ctx.approval`、`ApprovalRequest`、`ApprovalOutcome`、会话策略 `ask`/`never`
- [tools.md](../../oss/deepseek-harness/docs/subsystems/tools.md) — 工具执行 seam（`tools/pre-execute`、`PreToolDecision`、`ToolExecution`）
- [commands.md](../../oss/deepseek-harness/docs/subsystems/commands.md) — 命令注册（`ctx.commands.register`、`CommandResult`）
- [permission-presets.md](../../oss/deepseek-harness/docs/subsystems/permission-presets.md) — 权限预设（sandbox 模式 × 审批策略）
- [session.md](../../oss/deepseek-harness/docs/subsystems/session.md) — `Session` / 事件模型（审批审计事件 `approval/asked`/`decided`）
- 根目录目录：`docs/persistence-catalog.md`（`SessionEventMap` 全量事件）、`docs/tool-catalog.md`（工具清单，含 `write`/`edit`/`str-replace-editor`）、`docs/config-catalog.md`（配置清单）

### 关键源码（`packages/`）

| 接口 | 文件 |
|---|---|
| `tools/pre-execute`、`PreToolDecision`（`allow`/`deny`/`ask`）、`serviceAsk` 审批路由 | [packages/core/tools/src/index.ts](../../oss/deepseek-harness/packages/core/tools/src/index.ts) |
| `ctx.approval`、`ApprovalOutcome` | [packages/interaction/user-approval/src/index.ts](../../oss/deepseek-harness/packages/interaction/user-approval/src/index.ts) |
| 审批响应 outcome 词汇（`allowed-once`/`rejected`） | [packages/host/apiproxy/src/api/approvals.schema.ts](../../oss/deepseek-harness/packages/host/apiproxy/src/api/approvals.schema.ts) |
| 审批面板 DOM 锚点（`data-approval-key`、按钮） | [packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.tsx](../../oss/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.tsx) |
| `CommandDefinition`、`CommandInvocation` | [packages/interaction/commands/src/index.ts](../../oss/deepseek-harness/packages/interaction/commands/src/index.ts) |
| 客户端 `SessionFace`（`command`） | [packages/client/runtime/src/client/contract/session.ts](../../oss/deepseek-harness/packages/client/runtime/src/client/contract/session.ts) |
| 客户端 `PendingWait`（approval payload 的 `toolName`/`approvalId`） | [packages/client/runtime/src/client/sessions/pending.ts](../../oss/deepseek-harness/packages/client/runtime/src/client/sessions/pending.ts) |
