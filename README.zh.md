# dsh-edit-approval

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供**编辑前审批**：**每次 `write` / `edit` / `str_replace_editor` 调用都在文件真正落盘前先询问**——弹出红绿行级 diff，然后**同意一次 / 拒绝**；可在 Settings → General 一键关闭。

[![npm version](https://img.shields.io/npm/v/dsh-edit-approval.svg)](https://www.npmjs.com/package/dsh-edit-approval)
[![npm license](https://img.shields.io/npm/l/dsh-edit-approval.svg)](https://github.com/SiriLee/dsh-edit-approval/blob/main/LICENSE)

> [English](README.md) | 中文

## ✨ 功能特性

| 特性 | 说明 |
| --- | --- |
| 写前审批 | 在 `tools/pre-execute` 拦截 `write` / `edit` / `str_replace_editor`，任何文件修改前先询问 |
| 红绿行级 diff | 按各工具语义计算行级 diff（新增 / 删除 / 上下文），审批面板**只显示改动行**——行号右对齐加 `|`（如 `   15| +XI-EDITED`），被跳过的上下文与 hunk 间隔以 `…` 标记 |
| 面板折叠 | 长 diff 时点击警示条右端的折叠按钮隐藏详情，露出 Agent 输出；纯 CSS 显隐，展开即还原 |
| 同意一次 / 拒绝 | 两种操作，参照 Claude Code 的 edit approval 流程；拒绝会反馈给模型 |
| 总开关 | Settings → General 的「编辑前审批」开关，由 `/approval-edit on\|off\|status` host 命令支撑（同源） |
| 策略联动 | 尊重会话审批策略：`ask` 正常拦截，`never`（全权）直接放行 |
| 阈值控制 | `minDiffLines`、`includeCreate`、`includeDelete` 精细控制 |

## 📸 截图

<table>
  <tr>
    <td align="center"><img src="assets/screenshots/settings-switch.png" width="440" alt="Settings → General 总开关"><br><sub>Settings → General 总开关</sub></td>
    <td align="center"><img src="assets/screenshots/status-command.png" width="440" alt="聊天中的 /approval-edit 命令及其参数"><br><sub>聊天中的 /approval-edit 命令及其参数</sub></td>
  </tr>
  <tr>
    <td align="center" colspan="2"><img src="assets/screenshots/approval-panel.png" width="760" alt="审批面板：红绿行级 diff"><br><sub>审批面板——红绿行级 diff</sub></td>
  </tr>
</table>

## 📦 安装

已发布 npm——**优先走 registry 直装**；安装后**重启 dsh web（`--profile web`）生效**。

```sh
dsh plugin --profile web add dsh-edit-approval
```

贡献者：本地 checkout（`dsh plugin --profile web add /path/to/dsh-edit-approval`）、固定 commit（`dsh plugin --profile web add github:SiriLee/dsh-edit-approval#<sha>`）或离线 tarball（`npm pack` 后 `dsh plugin --profile web add ./dsh-edit-approval-<version>.tgz`）。git 安装首次会失败：pnpm 默认阻止 git 依赖执行构建脚本，按提示在 profile 的 `pnpm-workspace.yaml` 添加 `allowBuilds` 键后重试，之后会运行插件 `prepare` 并完成安装；`npm pack` 同样会运行 `prepare`，tarball 内始终包含预构建 `lib/`（含 `.d.ts`）与 `LICENSE`。

## 工作原理

插件监听 `tools/pre-execute` 瀑布（harness 在工具执行前运行的 seam），匹配注册工具名白名单：`write`、`edit`、`str_replace_editor`。对每个被拦截的调用：

1. **解析目标文件**：经 `ctx.fs` 解析路径，沿用 fs 工具的会话 cwd 规则（相对路径含 `..` 时对 cwd 做规范化）。
2. **读取当前内容**并按工具参数重建**拟写入内容**，镜像各工具语义：
   - `write` — 全文；`edit` — 唯一替换（或 `replace_all`）；
   - `str_replace_editor` — `str_replace` 唯一替换、`insert` 按行插入、`create` 用 `file_text`。
3. **计算行级 diff**：用 jsdiff 的 `structuredPatch`（Myers）对当前内容与拟写入内容求 diff——与 harness 的 write/edit 结果卡同一参考实现、同一 3 行上下文窗口，因此**审批预览与执行后的结果卡同源同形**，大文件里改 1 行仍是 1 行 diff。
4. **返回 `{ kind: 'ask', reason }`**：头部一行（`工具名 · 文件 (操作): N insertions, M deletions`）加 diff 文本——改动行带**右对齐行号 + `|`**（如 `   15| -xi` / `   15| +XI-EDITED`），上下文行与 `⋯` hunk 间隔随同一 structuredPatch 源携带（与 harness 结果卡同源）。harness 自带的 `serviceAsk` 经 `ctx.approval` 路由到 Web 审批面板——**host 端零 UI 改动**。`allowed-once` 继续执行、`rejected` 拒绝调用；其余情况一律 `next()` 委托后续监听器。

浏览器端（`dsh.client`）把面板纯文本 headline 重建为**仅改动行**——删除红色、新增绿色、右对齐 `NN|` 行号——被跳过的上下文与 hunk 间隔以 `…` 省略号标记；注入一条 `white-space: pre-wrap` 补偿样式修复 headline 的 CSS 折叠，为多行 diff 安装折叠按钮，并注册 Settings → General 总开关。所有副作用收敛在单个 `ctx.effect`（插件卸载 / HMR 时完整清理），按动画帧合并的 `MutationObserver` 负责发现并增强审批面板。

## 与审批策略的联动

harness 的会话审批策略（`ask` / `never`）持续生效：

| 会话策略 | 插件行为 |
| --- | --- |
| `ask`（如 `workspace-write` 预设） | 正常拦截并弹出审批面板 |
| `never`（如 `danger-full-access` 预设） | 直接放行——编辑不再询问，由沙箱继续约束 |

在 `never` 下，插件发出的每个 `ask` 都会被审批服务确定性转为拒绝，导致全权会话里所有编辑被静默拦截。因此插件停止询问、交由沙箱兜底。插件绝不扩大权限，也不改变沙箱模式。

## 配置

运行时配置统一在 `edit-approval` 设置命名空间，层级为**schema 默认值 < cordis 行 config < 用户设置页（持久化）**。cordis 行默认不带 config；profile patch 只需重写要改的键即可覆盖部署默认值：

```yaml
# profile 的 cordis.patch.yml
- id: dsh-edit-approval
  name: dsh-edit-approval
  config:
    minDiffLines: 2
    includeCreate: false
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关（用户可关） |
| `tools` | `['write','edit','str_replace_editor']` | 拦截白名单（注册工具名） |
| `minDiffLines` | `0` | 变更行数**至少**达到此值才询问；更小的改动静默放行 |
| `includeCreate` | `true` | 新建文件是否询问 |
| `includeDelete` | `true` | 清空/删除文件是否询问 |

## 行为细节与限制

- 只拦截写类**工具**；`bash`/`pwsh` 命令内的文件修改不在范围内。
- diff 以 `+` / `-` 行标记呈现——只读预览，非交互式逐行选择；不支持「部分应用」。
- 工具自身会失败的情形**不询问**、放行由工具报错：`str_replace_editor create` 命中已存在文件、`old_str`/`old_string` 非唯一或不存在。空 `old_string` 的 `edit` 预览与工具行为有偏差（视为 not-found 放行），偏差方向安全，不会误拦截。
- 按钮文案按 `navigator.language` 而非 `ctx.locale`——自包含 bundle 的有意简化。
- 注意注册工具名是 `str_replace_editor`（下划线），与 npm 包名 `@deepseek-ai/dsh-tool-str-replace-editor` 不同。

## 明确不包含

- 编辑后审查 / 回滚——由社区 [dsh-change-review](https://github.com/cirelir/dsh-change-review) 覆盖。
- 快捷键（Enter 审批 / Esc 拒绝）——已拆分为独立插件。
- 权限档位扩展——由社区 [dsh-auto-approval-plugin](https://github.com/StyxNether/dsh-auto-approval-plugin) 覆盖。

## 兼容性

- Node.js `^22.19.0 || >=24.0.0`。
- DeepSeek Harness web 配置档（`dsh --profile web`）；`@deepseek-ai/*` peer 包由 harness 运行时提供。

> [!WARNING]
> 本项目与 DSH 均处于 developer preview。可复现环境请固定精确版本，并留意上文的行为说明。

## 开发

```sh
npm install            # devDeps 来自 npm registry
npm run typecheck      # tsc 双编译面（host + client）
npm test               # vitest：diff / guard 单测 + 真实 cordis 集成测试 + jsdom 面板折叠测试（54 用例）
npm run build          # 全量构建：tsc → lib/（含 .d.ts）+ lib/client.js bundle
npm run build:portable # 可选：轻量 esbuild 构建，不做类型检查
node scripts/verify-host.mjs   # 对 BUILT host 产物做端到端验证
```

`prepare` 生命周期运行全量构建，因此 git 安装与 `npm pack`/`npm publish` 始终得到完整的 `lib/`（含 `.d.ts`）与 `LICENSE`。

## 发布

发版走 GitHub Actions Trusted Publishing（OIDC，无需存储 `NPM_TOKEN`）。详见 [docs/npm-trusted-publishing-guide.md](docs/npm-trusted-publishing-guide.md)。

```sh
npm version patch && git push origin main --tags   # 触发 .github/workflows/publish.yml
```

workflow 会校验 tag 与 `package.json` 版本一致，执行 typecheck + 测试 + 全量构建 + 产物验证，以 Sigstore provenance 发布并创建 GitHub Release。CI（`.github/workflows/ci.yml`）在每次 push / PR 上运行同样的检查。发布步骤幂等——版本已在 npm 则跳过。

## 目录结构

```
src/index.ts            host 插件：tools/pre-execute 拦截 + /approval-edit 命令 + settings
src/diff.ts             行级 diff（纯函数：jsdiff structuredPatch 映射、渲染、统计）
src/guard.ts            决策逻辑（纯函数：工具匹配、阈值、create/delete、ask/放行）
src/client/index.ts     client 插件：红绿 diff 渲染 + 总开关 + 生命周期
src/client/settings-row.tsx   Settings → General 开关行
tests/                  vitest 套件（diff / guard / 集成 / client 折叠）
scripts/                构建与产物验证
cordis.patch.yml        bundle patch（挂载 host 插件行）
package.json            dsh.bundle + dsh.client 声明、peerDependencies
```

## 安全

本插件仅在 `tools/pre-execute` 拦截点读取目标文件以计算预览 diff，从不自行写入文件——只有在你批准后，工具本体才执行写入。无网络请求，不访问任何凭据。

## License

[MIT](LICENSE)
