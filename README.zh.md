# dsh-edit-approval

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供**先询问后执行**的审批：**每次 `write` / `edit` 调用都在文件真正落盘前先询问——弹出红绿行级 diff，同意一次 / 拒绝——每次 `bash` 命令执行前也先询问**，两者各自的总开关位于 **Settings → Plugins** 里本插件的卡片上。

[![npm version](https://img.shields.io/npm/v/dsh-edit-approval.svg)](https://www.npmjs.com/package/dsh-edit-approval)
[![npm license](https://img.shields.io/npm/l/dsh-edit-approval.svg)](https://github.com/SiriLee/dsh-edit-approval/blob/main/LICENSE)

> [English](README.md) | 中文

刻意保持聚焦，只做一件事：**两扇镜像对称的审批门——编辑与命令**——让 agent 未经你同意就无法改动文件或执行命令。

| 审批门 | 拦截目标 | 默认 | 面板 |
| --- | --- | --- | --- |
| **编辑审批** | `write` / `edit`（`str_replace_editor` 需自行选入） | 开 | 红绿行级 diff——同意一次 / 拒绝 |
| **命令审批** | `bash` | 关 | 描述 headline + 原生命令行 |

两扇门共用 harness 自带的 `serviceAsk` seam：插件在 `tools/pre-execute` 返回 `{ kind: 'ask', reason }`，harness 将其路由进 Web 审批面板——**host 端零 UI 改动**——`allowed-once` 继续执行、`rejected` 拒绝调用；在 `never` 策略下插件直接委托，全权会话照常工作。

## 效果预览

所有写类调用先弹出红绿 diff 面板；开启命令审批后，每条命令先弹出面板：白色 headline 是 agent 的描述，灰色行是命令原文。两个总开关位于 **Settings → Plugins** 里本插件的卡片上。

<table>
  <tr>
    <td align="center"><img src="assets/screenshots/edit-approval-panel.png" width="440" alt="编辑审批面板：红绿行级 diff"><br><sub>编辑审批面板——红绿行级 diff</sub></td>
    <td align="center"><img src="assets/screenshots/bash-approval-panel.png" width="440" alt="命令审批面板：描述 headline 与命令行"><br><sub>命令审批面板——描述 + 命令</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/screenshots/approval-commands.png" width="440" alt="/approval-edit 与 /approval-bash 命令"><br><sub>/approval-edit 与 /approval-bash 命令</sub></td>
    <td align="center"><sub>两个总开关在 <b>Settings → Plugins</b> 的本插件卡片上暂存：拨动后按 <b>保存</b>。</sub></td>
  </tr>
</table>

## 安装

```sh
dsh plugin --profile web add dsh-edit-approval
```

装完重启 `dsh web`（`--profile web`）生效。

给贡献者：可从本地 checkout、pin 的 commit 或离线 tarball 安装——`dsh plugin --profile web add /path/to/dsh-edit-approval`、`dsh plugin --profile web add github:SiriLee/dsh-edit-approval#<sha>` 或 `npm pack` 后 `dsh plugin --profile web add ./dsh-edit-approval-<version>.tgz`。git 安装首次会失败：pnpm 默认禁止 git 依赖执行构建脚本，需先在 profile 的 `pnpm-workspace.yaml` 加 `allowBuilds`；之后 pnpm 会执行插件的 `prepare` 并装入 profile。`npm pack` 同样运行 `prepare`，tarball 内始终包含预构建 `lib/`（含 `.d.ts`）与 `LICENSE`。

## 使用

1. **编辑审批默认开启。** 任何 `write` / `edit` 调用都在文件被触碰前先询问。面板只显示改动行——删除红色、新增绿色——带右对齐 `NN|` 行号 gutter，被跳过的上下文与 hunk 间隔以 `…` 省略号标记。
2. **同意一次 / 拒绝。** `allowed-once` 放行该调用；`rejected` 拒绝并反馈给模型。
3. **命令审批默认关闭**——在本插件卡片上或通过下面的命令开启。面板白色 headline 是描述（如 `bash · push to remote`）；下方灰色行是命令原文，由 harness 原生渲染。
4. **命令行入口：** `/approval-edit on|off|status` 与 `/approval-bash on|off|status`——与配置页写同一份文档，两者不可能不一致。
5. **白名单（仅配置文件）：** `bashAllow` 存放始终放行的命令前缀。匹配做了空白归一化（`git  push` 命中 `git push`），无法用多余空格绕过。暂不提供 UI。

## 原理

插件监听 `tools/pre-execute` 瀑布（harness 在工具执行前的 seam），按工具名分派到两扇门之一——名称重叠时编辑门优先。

### 1. 编辑审批

对每个被拦截的写类调用：

1. **解析目标文件**：经 `ctx.fs` 解析路径，使用 fs 工具所写的会话 cwd 原文（DSH 0.1.7 起 fs 工具不再对含 `..` 的 cwd 做规范化，本预览同样不做）。
2. **读取当前内容**，并按各工具自身的语义从参数重建"拟写入内容"：`write`——全文；`edit`——单次唯一替换（或 `replace_all`）；`str_replace_editor`——`str_replace` 唯一替换、`insert` 按行插入、`create` 取 `file_text`。
3. **计算行级 diff**：用 jsdiff 的 `structuredPatch`（Myers），与 harness 写类结果卡片同一个参考实现、同一个 3 行上下文窗口——因此审批预览与批准后的结果卡片同源，大文件里改一行就只显示一行。
4. **返回 `{ kind: 'ask', reason }`**：首行是摘要（`tool · file (op): N insertions, M deletions`），其后是 diff 文本。harness 的 `serviceAsk` 将其经 `ctx.approval` 路由进 Web 审批面板。

### 2. 命令审批

纯判定，**完全不碰 fs**——既不读也不写：

- 以下情况直接放行：门已关闭、工具不在 `bashTools` 中、命令为空、或该调用是**沙箱提权**（带 `sandbox_permissions` + `justification`，它们自带审批，不能重复询问）。
- **白名单优先**：空白归一化后的前缀命中即放行。
- 否则返回 `{ kind: 'ask', reason }`，只有一行 headline——`bash · <描述>`（描述为空时就是 `bash`）。命令原文**不**写进 reason：harness 会在面板的命令行里原生渲染，避免重复。

### 3. 共享策略处理

会话审批策略（`ask` / `never`）始终生效。在 `never` 下（如 `danger-full-access`），本插件发出的每个 `ask` 都会被审批服务确定性拒绝，从而静默打断全权会话里的所有编辑与命令——所以两扇门都改为经 `next()` 委托，交由沙箱执行。插件绝不扩大权限，也不改动沙箱模式。

### 4. 审批面板

浏览器半边（`dsh.client`）在面板出现时增强它（按动画帧合并的 `MutationObserver`，所有副作用都在单个 `ctx.effect` 内，卸载 / HMR 时拆除）：

- **编辑面板**：从纯文本 headline 重建为只有改动行——删除红色、新增绿色、右对齐 `NN|` gutter——并附 `white-space: pre-wrap` 补偿，多行 diff 再加一个折叠按钮。
- **命令面板**：保持 harness 原生外观，只加一个 `dsh-ea-kind-command` 标记，不重排样式、不重建——白色描述 headline 与灰色命令行就是 harness 渲染的样子。

## 配置

本插件的全部配置就是**一个 profile 条目**——bundle patch 插入的 `dsh-edit-approval` 行——分层为 **schema 默认值 < 行配置 < 用户配置页（持久化）**。patch 刻意不带 config：`src/index.ts` 里的 schema 默认值是唯一真源，profile patch 只需重述它要改的键：

```yaml
# profile 的 cordis.patch.yml
- id: dsh-edit-approval
  name: dsh-edit-approval
  config:
    editMinDiffLines: 2
    editIncludeCreate: false
    bashEnabled: true
```

| 键 | 默认 | 位置 | 说明 |
| --- | --- | --- | --- |
| `editEnabled` | `true` | 配置页 | 编辑审批总开关 |
| `bashEnabled` | `false` | 配置页 | 命令审批总开关 |
| `editTools` | `['write','edit']` | 配置文件 | 被拦截的写类工具名 |
| `editMinDiffLines` | `0` | 配置文件 | 改动达到**至少**这么多行才询问；更小的改动静默放行 |
| `editIncludeCreate` | `true` | 配置文件 | 新建文件是否询问 |
| `editIncludeDelete` | `true` | 配置文件 | 清空 / 置空文件是否询问 |
| `bashTools` | `['bash']` | 配置文件 | 被拦截的命令类工具名 |
| `bashAllow` | `[]` | 配置文件 | 始终放行的命令前缀（空白归一化） |

只有两个总开关是 live 字段——这正是它们成为"配置页唯一展示、也是设置写入唯一可寻址"字段的原因：改动立即生效，无需重启。其余都是普通配置，在条目加载时读取，因此放在 profile 文件里。

开关被拨回 schema 默认值时是**清除**而非固化，所以 profile patch 只保留你真正改过的东西，日后的默认值变更仍能送达你。

`str_replace_editor` 默认不被拦截——它自 DSH 0.1.3 起不再是默认工具。针对它的 guard 分支仍然随包发布并有单测；把 `str_replace_editor` 加进 `editTools` 即可启用。

> **从 0.3.x 升级。** `edit-approval` 与 `bash-approval` 两个设置命名空间已不存在，键名改为上面的扁平字段。DSH 的设置服务会把旧 `settings.yaml` 的 section 导入**同名**条目，而这两个旧名字都不是 profile 条目 id，因此**不会迁移**。若你此前开着命令审批，请在 profile patch 里写上 `bashEnabled: true`（或在新配置页拨一次）。

## 明确不做的事

- **不绕过也不扩大沙箱**——从不改动沙箱模式或授予权限；提权调用交给沙箱自己的审批。
- **不拦截命令内部**——在 `bash` 命令里发生的文件改动不由编辑门管辖（开启命令审批后由它覆盖）。
- **不做部分应用**——diff 是只读预览（`+` / `-` 行标记），不支持"只应用其中几行"。
- **不对工具本身会失败的调用提问**——例如对已存在文件执行 `str_replace_editor create`、`old_str` / `old_string` 缺失或不唯一；这些直接放行，由工具自己报错。空的 `old_string` 编辑预览与工具行为有偏差（按"未找到"处理）——这是安全的，绝不会误拦。
- **不做快捷键**（Enter 批准 / Esc 拒绝）——已拆到独立的 [dsh-approval-hotkeys](https://github.com/SiriLee/dsh-approval-hotkeys) 插件。
- **不做改后复查 / 回滚**——见社区插件 [dsh-change-review](https://github.com/cirelir/dsh-change-review)。
- **不扩展权限层级**——见社区插件 [dsh-auto-approval-plugin](https://github.com/StyxNether/dsh-auto-approval-plugin)。

## 兼容性

- Node.js `^22.19.0 || >=24.0.0`。
- DeepSeek Harness web profile（`dsh --profile web`）；`@deepseek-ai/*` 由 harness 在运行时解析，本包不会自行拉取。
- **仅支持 DSH `0.1.7-rc.1`**，声明为单个 `^0.1.7-rc.1` peer 元组，`dsh.engines.dsh = ">=0.1.7-rc.1"`。本插件一次只追一条 DSH 线，不保持对更早版本线的兼容：声明之外的运行时会在启动时**跳过该 bundle 并给出 peer 诊断**，而不是把它加载成半坏状态。同元组的预发布滚动（`rc.1 → rc.2`）无需改动。
- `node scripts/check-dsh-version.mjs` 盯发布节奏：校验声明自洽（各 harness peer 同一元组、engine floor 同步），并在 DSH 发布了声明窗口之上的版本时报告。
- **为什么是单线。** DSH 0.1.7 把本插件两扇门共用的设置命名空间注册表换成了"每个 profile 条目一个 live `Config`"，同时删除了浏览器侧 `dsh-client-runtime` 包与 `settingsScope` 服务。旧模型没有 1:1 后继，因此同时兼容更早的线意味着维护两套设置模型、两条客户端写路径与两种会话读取形状。逐 seam 的完整记录（包括哪些失效是静默的）见 [docs/compat/0.1.7-audit.md](docs/compat/0.1.7-audit.md)。
- 注册的工具名是 `str_replace_editor`（下划线），与 npm 包名 `@deepseek-ai/dsh-tool-str-replace-editor` 不同。

> [!WARNING]
> 本项目与 DSH 均处于开发者预览阶段。请在可复现环境中 pin 精确版本，并留意上述行为说明。

## 安全

插件只在 `tools/pre-execute` 拦截点读取目标文件以计算编辑预览；命令门完全不碰文件。它自己从不写文件——工具主体只在你批准后才执行写入。它不发起网络请求，也不访问任何凭据。

## 开发

```sh
npm install            # 装 devDeps（harness 包精确钉到目标线）
npm run typecheck      # 对两套编译面做 tsc，跑在真实 DSH 类型上
npm test               # vitest：diff / guards / config / integration / client / package-layout
npm run build          # scripts/build.mjs：声明 + 两个产物 + 冒烟检查
npm run verify:host    # 在真实 cordis Context 上驱动**已构建**的 host 产物
npm run check          # typecheck + tests + build + verify:host + npm pack --dry-run
```

`prepare` 会跑构建，因此 git 安装与 `npm pack` / `npm publish` 始终产出完整的 `lib/`（含 `.d.ts`）与 `LICENSE`。

其中两步的存在，是因为让本插件整整报废一条 DSH 线的两种失效**都是静默的**：

- 构建会被自己的冒烟检查拦住：客户端产物**不允许内联任何 `node_modules` 输入**（经 esbuild 的 metafile 检查），所以 externals 列表漏掉一个平台模块会让构建失败，而不是悄悄打进第二份 React；同时两个产物都不得引用目标线已删除的包。
- `verify:host` 把 settings 替身**双向**锚定到真实的 `SettingsForms.prototype`。此前那个替身只实现了一个方法——`settings.register`，恰好是 0.1.7 删掉的那一个——于是套件与插件互相印证、与真实世界无关，绿着穿过了它本该拦住的那次断裂。

## 发布

发布走 GitHub Actions Trusted Publishing（OIDC，不存 `NPM_TOKEN`）。见 [docs/npm-trusted-publishing-guide.md](docs/npm-trusted-publishing-guide.md)。

```sh
npm version patch && git push origin main --tags   # 触发 .github/workflows/publish.yml
```

工作流会校验 tag 与 `package.json` 一致，跑 typecheck + 测试 + 完整构建 + 产物校验，带 Sigstore provenance 发布，并创建 GitHub Release。CI（`.github/workflows/ci.yml`）在每次 push / PR 上跑同样的检查。发布步骤是幂等的——npm 上已存在的版本会被跳过。

## 许可

[MIT](LICENSE)
