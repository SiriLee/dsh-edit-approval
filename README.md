# dsh-edit-approval

DeepSeek Harness 插件：**编辑前审批**——`write` / `edit` / `str_replace_editor` 执行前显示**红绿行级 diff**（Claude Code 行为），用户选择：**同意 / 拒绝 / 对本命令总是同意**；可随时关闭（用户开关）。

> 状态：**已实现（v0.1.0）**。交互以 Claude Code 的 edit approval 为参考，并贴合 dsh Web 实际 UI（复用现有审批面板与 DOM 锚点，纯插件、不改仓库核心）。

## 背景与定位

社区编辑审查类插件是**事后**路线（[`dsh-change-review`](https://github.com/cirelir/dsh-change-review) 跟踪并渲染 diff、可回滚，但不拦截执行）；审批类插件（[`dsh-smart-approval`](https://github.com/TingRuDeng/dsh-smart-approval)、[`dsh-auto-approval-plugin`](https://github.com/StyxNether/dsh-auto-approval-plugin)）调整的是审批**模式/权限档位**，不针对单个编辑。「编辑前逐 diff 审批 + 总是允许」在社区是空白。

## 交互设计（Claude Code 参考）

### 1. 每次编辑前：红绿 diff + 三选一

Agent 调用 `write` / `edit` / `str_replace_editor` 时，**不直接落盘**，先弹出审批面板：

- 面板头部：工具名 + 目标文件 + 变更统计（如 `edit · src/foo.ts (modify): 2 insertions, 1 deletion`）；
- 主体：**红绿行级 diff**（`+` 新增行、`-` 删除行、` ` 上下文），与 Claude Code 的 edit approval 一致；
- 操作三选一：
  - **同意**（允许一次）——本次编辑执行
  - **拒绝**——本次编辑不执行，模型收到「用户拒绝了 write」反馈，可自行调整
  - **总是允许**——本次执行，且该工具加入「始终允许名单」，以后不再询问（可随时移除）

### 2. 用户开关

- 总开关（`enabled`）：随时开启/关闭整个插件（关闭后编辑直接执行，无审批）；
- 设置方式：设置页开关（插件注册 `edit-approval` settings 命名空间，UI 自动渲染；**优先**）+ 命令 `/approval-edit on|off|status`（辅助）；
- 名单管理：`/approval-always <tool>`（添加）、`/approval-always list`、`/approval-always clear`（名单持久化在 settings 文档中，重启不丢）。

### 3. 与既有权限体系的关系

- 插件只对已进入 `tools/pre-execute` 的写类工具生效；`ctx.approval` 会话策略（`ask`/`never`）照常生效——预设为 `never` 时确定性拒绝，插件行为与权限预设联动，不绕过任何既有决策。
- 不改变沙箱模式；`read-only` 预设下写操作本就失败，插件不额外拦截。

## 机制（host 端，全部公开 API）

### 4. 拦截与审批路由

- 监听 `tools/pre-execute`（waterfall seam），匹配白名单工具（注册名：`write` / `edit` / `str_replace_editor`；注意 `str_replace_editor` 的注册名带下划线，与 npm 包名 `@deepseek-ai/dsh-tool-str-replace-editor` 不同）。
- 执行前经 `ctx.fs` 读取目标文件当前内容（沿用 fs 工具的会话 cwd 规则），对工具参数计算**拟写入内容**（`write` 全文、`edit` 唯一替换/`replace_all`、`str_replace` 唯一替换、`insert` 按行插入、`create` 用 `file_text`），再与当前内容计算**行级 diff**（LCS 对齐，超大文件回退为整文件替换）。
- 返回 `{ kind: 'ask', reason: '<工具名与文件与统计> \n <diff 文本>' }`：harness 内部 `serviceAsk` 自动调用 `ctx.approval.request(...)` 并把 `reason` 路由到 Web 审批面板 headline（已验证 `ApprovalPanel.tsx` headline 渲染 reason、无长度上限、body 可滚动）——**host 端零 UI 改动**。
- `allowed-once` → 工具继续；`rejected` → 工具 deny（不执行）。非询问情形一律 `return next()` 委托后续监听器，不短路其他策略。

### 5. 「总是允许」名单

- 持久化于 `edit-approval` settings 命名空间的 `alwaysAllow` 字段（schema 默认 `[]`），`tools/pre-execute` 先查名单，命中则 `next()` 放行，不打扰。
- 名单写入入口：命令 `/approval-always <tool>`（host 端注册，公开 `ctx.commands`），客户端「总是允许」按钮复用它。

## 客户端实现要点（纯插件，无源码补丁）

- 「总是允许」第三按钮：注入到现有审批面板 `[data-approval-key]` 容器内的操作行（与「拒绝/允许一次」并排），仅依赖稳定 DOM 锚点，无新页面、无新弹窗、无 React。
- 点击「总是允许」= 两步：①模拟点击面板既有「允许一次」按钮（本次放行）；②经 `session.command('/approval-always <tool>')` 把工具加入名单（工具名从运行时 `session.getSnapshot().pending` 中按 `data-approval-key` 匹配到的 approval payload 的 `toolName` 获取）。
- 面板出现/消失由 `MutationObserver` 观察 `[data-approval-key]` 处理；按钮文案按浏览器语言显示「总是允许 / Always allow」。
- **换行补偿**：审批面板 `.headline` 的 CSS 无 `white-space: pre-wrap`，HTML 会把 reason 里的 `\n` 折叠成空格，行级 diff 会挤成一行。插件注入一条按稳定属性锚点定位的样式（`[data-approval-key] [data-approval-scroll] > div:first-child { white-space: pre-wrap; }`）恢复换行；上游若修复此样式则本规则自然冗余无害。
- **生命周期**：所有副作用（observer、样式、待触发的 DOMContentLoaded 钩子）注册为单个 `ctx.effect`，插件卸载 / HMR 时完整清理。

## 配置项

运行时配置统一由 settings 命名空间 `edit-approval` 提供：**schema 默认 < cordis 行 config < 用户设置页（持久化）**。cordis 行默认不带 config（见 `cordis.patch.yml`），如需经 profile patch 调整部署默认值，可覆盖该行：

```yaml
# 例：profile 的 cordis.patch.yml
- id: dsh-edit-approval
  name: dsh-edit-approval
  config:
    minDiffLines: 2
    includeCreate: false
```

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关（用户可关） |
| `tools` | `['write','edit','str_replace_editor']` | 拦截白名单（注册工具名） |
| `minDiffLines` | `0` | 变更行数**低于**此值不询问（放行小改动） |
| `includeCreate` | `true` | 新建文件是否询问 |
| `includeDelete` | `true` | 清空/删除是否询问 |
| `alwaysAllow` | `[]` | 「总是允许」名单（命令/客户端维护，持久化） |

## 边界与已知限制

- 只拦截写类**工具**；bash/pwsh 命令内的文件修改不在本期范围。
- diff 以文本形式呈现在审批面板（`+`/`-` 行标记），非交互式逐行选择；「部分应用」不做。
- `str_replace_editor` 的 `create` 命中已存在文件、`old_str`/`old_string` 非唯一或不存在等**工具自身会失败**的情形，插件不询问（放行后由工具报错）。空 `old_string` 的 `edit` 预览与实际工具行为有偏差（插件视为 not-found 放行；偏差方向安全，不误拦截）。
- 「总是允许」名单持久化于 settings 文档（经 `/approval-always` 维护）；若 settings 提供方不可用则退化为无名单。
- 已记录的取舍：按钮文案按浏览器语言（`navigator.language`）而非 dsh `ctx.locale`（自包含 bundle 的有意简化）；`peerDependencies` 大多声明为 `"*"`（规避 pnpm 在 git 安装时对未完整发布传递图的自动解析）；「允许一次」按钮按面板按钮顺序（reject 在前）推断，若上游面板结构调整需同步更新 `src/client/index.ts` 的注释处。

## 明确不包含（本期）

- 编辑**后**审查/回滚面板——社区已有（`dsh-change-review`）。
- 快捷键（enter 审批 / esc 拒绝等）——独立快捷键插件，二期。
- 权限档位扩展（中间权限层）——社区已有（`dsh-auto-approval-plugin`）。

## 构建与测试

```sh
npm install        # devDeps 全部来自 npm registry（@deepseek-ai/dsh-* 0.1.0-rc.6、
                   # cordis ^4.0.1、schemastery ^3.18.1），任意机器可直接安装，
                   # 不再需要本机 deepseek-harness checkout
npm run typecheck  # tsc 双编译面（host + client 声明）
npm test           # vitest：diff / guard 纯函数单测 + 真实 cordis Context 集成测试（43 个用例）
npm run build      # 作者全量构建：tsc → lib/（含 .d.ts）+ scripts/build-client.mjs → lib/client.js
npm run build:portable  # 自包含构建（prepare 用）：esbuild 打包 host 单文件 + client，
                        # 无需任何 @deepseek-ai 类型——git 安装/打包时自动执行
```

## 安装

三种方式任选；安装后需**重启 dsh web**（`--profile web`）生效。

### 方式 1：本地 checkout（作者 / 贡献者）

```sh
cd dsh-edit-approval
npm install      # 本机存在 deepseek-harness checkout 时自动链接其包用于类型检查/测试
npm run build    # tsc 全量构建（含 .d.ts）
dsh plugin --profile web add /path/to/dsh-edit-approval   # link: 安装
```

### 方式 2：GitHub 安装（其他使用者；推荐）

```sh
dsh plugin --profile web add github:SiriLee/dsh-edit-approval#<commit-sha>
```

首次会失败：pnpm 默认阻止 git 依赖执行构建脚本。按 CLI 提示把 `allowBuilds` 键
写入 profile 的 `pnpm-workspace.yaml`（例如 `$DSH_HOME/profiles/web/pnpm-workspace.yaml`），
再重跑一次即可。之后 pnpm 会自动运行插件的 `prepare`（自包含 esbuild 构建，无需本机
harness checkout），并安装到 profile 内。建议**固定 commit**（`#<sha>`），避免上游
push 静默改变安装时执行的代码。

### 方式 3：tarball / npm 发布（预构建产物，无需放行构建）

```sh
npm pack                                # 在插件仓库生成 dsh-edit-approval-0.1.0.tgz
dsh plugin --profile web add ./dsh-edit-approval-0.1.0.tgz
```

包内已含预构建 `lib/`，`dsh plugin add` 不再运行任何构建脚本。发布到 npm 后可直接
`dsh plugin --profile web add dsh-edit-approval`。

## 验证效果

### 1. 验证安装生效

```sh
# 配置层已组合（无需启动）
dsh --profile web --dump-config | grep -A 3 'dsh-edit-approval'

# 启动后浏览器客户端模块图含本插件（bundle 由 host 服务）
curl -s http://127.0.0.1:3080/ | grep -o '"id":"dsh-edit-approval"'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/plugins/dsh-edit-approval/client.js   # 200
```

### 2. 功能验证（审批面板）

新开会话，让模型执行一次写操作（如 `write src/demo.ts`）：

- **拒绝** → 工具返回「the user rejected tool "write"」，文件未写入，模型可自行调整；
- **同意**（允许一次）→ 本次写入执行，再次写操作仍会询问；
- **总是允许** → 本次写入执行，该工具加入始终允许名单，之后同类工具不再询问（可随时
  用 `/approval-always list` 查看、`/approval-always clear` 清除）。

面板头部应显示 `write · src/demo.ts (create): N insertions, 0 deletions`，主体为
`+`/`-` 前缀的红绿行 diff。

### 3. 验证开关与名单命令

```sh
/approval-edit status          # 查看总开关
/approval-edit off             # 关闭后写操作直接执行，不再询问
/approval-edit on
/approval-always edit          # 把 edit 加入始终允许名单
/approval-always list
/approval-always clear
```

### 4. 与权限预设联动

将 `ctx.approval` 会话策略切为 `never`（如 `danger-full-access` 预设）后，插件的
`ask` 会被确定性拒绝——即编辑一律不执行，插件不绕过任何既有决策。

### 5. 自动化验证（开发者）

```sh
npm run typecheck && npm test    # 43 个用例：diff/guard 纯函数 + 真实 cordis Context 集成
```

包声明 `dsh.bundle`（`cordis.patch.yml` 挂载 host 插件行）+ `dsh.client`（`exports["./client"]` 浏览器 bundle 自动入图），GitHub 仓库已打 `dsh-plugin` topic。

## 目录结构

```
src/index.ts            host 插件：tools/pre-execute 拦截 + /approval-always、/approval-edit 命令 + settings 注册
src/diff.ts             行级 diff 文本生成（纯函数：LCS 对齐、渲染、统计）
src/guard.ts            拦截决策逻辑（纯函数：工具匹配、阈值、名单、create/delete、ask/放行判定）
src/client/index.ts     client 插件：「总是允许」按钮注入 + 换行补偿样式 + 生命周期清理
tests/diff.spec.ts      diff 单测
tests/guard.spec.ts     guard 单测
tests/integration.spec.ts  真实 cordis Context + 桩服务的 host 集成测试
scripts/build-portable.mjs  自包含 esbuild 构建（prepare 生命周期）
scripts/build-client.mjs    client bundle 构建（loader 闭包单一来源）
cordis.patch.yml        bundle patch（插入插件行）
package.json            dsh.bundle + dsh.client 声明、peerDependencies(@deepseek-ai/*, optional)
tsconfig.json / tsconfig.client.json    host / client 双编译面
```

## 依赖的公开 API

- `@deepseek-ai/dsh-tools`：`tools/pre-execute` 事件、`PreToolDecision`、`ToolExecution`
- `@deepseek-ai/dsh-user-approval`：`ctx.approval`（由 `{kind:'ask'}` 自动路由）
- `@deepseek-ai/dsh-commands`：`/approval-always`、`/approval-edit` 命令注册
- `@deepseek-ai/dsh-settings`：`edit-approval` 命名空间（开关 + 名单持久化）
- `@deepseek-ai/dsh-fs` / `@deepseek-ai/dsh-sandbox`：目标文件读取与会话 cwd 规则
- 客户端：`@deepseek-ai/dsh-client-runtime/client`（`session.command`、`session.getSnapshot().pending`；全部 type-only，不进入 bundle）

## 参考：deepseek-harness 接口文档

本地 fork：`../../oss/deepseek-harness/` · 官方仓库：[github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)

### 子系统文档（`docs/subsystems/`）

- [approval.md](../../oss/deepseek-harness/docs/subsystems/approval.md) — `ctx.approval`、`ApprovalRequest`、`ApprovalOutcome`、会话策略 `ask`/`never`
- [tools.md](../../oss/deepseek-harness/docs/subsystems/tools.md) — 工具执行 seam（`tools/pre-execute`、`PreToolDecision`、`ToolExecution`）
- [commands.md](../../oss/deepseek-harness/docs/subsystems/commands.md) — 命令注册（`ctx.commands.register`、`CommandResult`）
- [permission-presets.md](../../oss/deepseek-harness/docs/subsystems/permission-presets.md) — 权限预设（sandbox 模式 × 审批策略）
- [session.md](../../oss/deepseek-harness/docs/subsystems/session.md) — `Session` / 事件模型（审批审计事件 `approval/asked`/`decided`）
- [client-modules.md](../../oss/deepseek-harness/docs/subsystems/client-modules.md) — `dsh.client` 扫描与 `__DSH_BOOT__` 图
- 根目录目录：`docs/persistence-catalog.md`（`SessionEventMap` 全量事件）、`docs/tool-catalog.md`（工具清单）、`docs/config-catalog.md`（配置清单）

### 关键源码（`packages/`）

| 接口 | 文件 |
|---|---|
| `tools/pre-execute`、`PreToolDecision`（`allow`/`deny`/`ask`）、`serviceAsk` 审批路由 | [packages/core/tools/src/index.ts](../../oss/deepseek-harness/packages/core/tools/src/index.ts) |
| `ctx.approval`、`ApprovalOutcome` | [packages/interaction/user-approval/src/index.ts](../../oss/deepseek-harness/packages/interaction/user-approval/src/index.ts) |
| 审批面板 DOM 锚点（`data-approval-key`、按钮） | [packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.tsx](../../oss/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ApprovalPanel.tsx) |
| `CommandDefinition`、`CommandInvocation` | [packages/interaction/commands/src/index.ts](../../oss/deepseek-harness/packages/interaction/commands/src/index.ts) |
| settings 命名空间（`SettingsScope`） | [packages/settings/settings/src/index.ts](../../oss/deepseek-harness/packages/settings/settings/src/index.ts) |
| 客户端 `SessionFace`（`command`） | [packages/client/runtime/src/client/contract/session.ts](../../oss/deepseek-harness/packages/client/runtime/src/client/contract/session.ts) |
| 客户端 `PendingWait`（approval payload 的 `toolName`/`approvalId`） | [packages/client/runtime/src/client/sessions/pending.ts](../../oss/deepseek-harness/packages/client/runtime/src/client/sessions/pending.ts) |
