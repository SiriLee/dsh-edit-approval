# dsh 插件发布到 npm 指南（GitHub Actions Trusted Publishing）

> 本指南基于 dsh-edit-approval 的完整发布闭环实测整理（0.1.0 本地 2FA 首发 →
> 配置 Trusted Publisher → 0.1.1 由 CI OIDC 发布并附加 Sigstore/SLSA provenance）。
> 适用于 dsh 生态的 host+client 双面插件（dsh.bundle + dsh.client）。

## 0. 前置检查

- **包名占用**：`npm view <name> version` 返回 404 才可用。npm 包名全局唯一，
  被占用只能改名（如 dsh-rewind 被他人占用 → 改为 dsh-rewind-plugin）。
- **npm 官方要求**：npm CLI ≥ 11.5.1 + Node ≥ 22.14（CI 用 Node 24 并在 workflow
  中显式 `npm install -g npm@latest`）。
- **发布就绪**：`package.json` 齐全（license + LICENSE 文件、repository、keywords、
  engines、files 白名单、exports 含 `./client`、`prepare` 可产出完整 lib/）；
  `cordis.patch.yml` 的行 `id`/`name` 与包名一致（改名后必须同步）。

## 1. npm 端一次性配置

**① 本地发布首个版本**（Trusted Publisher 必须包已存在才能配置；用本地登录态）：

```sh
npm publish --access public
```

- 若提示 `EOTP`（一次性密码）：npm 会给一个浏览器认证链接
  （`https://www.npmjs.com/auth/cli/...`，CLI 输出时打码尾部），在浏览器打开完成认证，
  或提供 authenticator 的 6 位码 `npm publish --otp=<code>` 重试。
- 首个版本无 provenance（本地路径），合规；后续 CI 发布自动带 provenance。

**② npmjs.com 配置 Trusted Publisher**（包发布后才有入口）：

- 打开 `https://www.npmjs.com/package/<name>` → 包右上角 **settings**
  （**不是**页面顶部标签；npm 维护者确认入口在"每个包的 settings"）→ **Trusted Publisher** 区块
- 字段：
  - Provider: **GitHub Actions**
  - Organization or user: GitHub 用户名/组织
  - Repository: GitHub 仓库名（可与 npm 包名不同）
  - Workflow filename: `publish.yml`（只填文件名，须存在于 `.github/workflows/`）
  - Environment: 留空
  - **Allowed actions: `npm publish`**（2026-05-20 后必须显式选择；`npm stage publish` 不需要）

## 2. workflow 文件（已实测模板）

**`.github/workflows/publish.yml`**：

```yaml
name: publish
on:
  push:
    tags: ['v*']
  workflow_dispatch:
permissions:
  contents: read
  id-token: write        # npm Trusted Publishing 必需（OIDC）
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24   # npm 官方要求 Node >= 22.14 / npm >= 11.5.1
      - name: Ensure npm >= 11.5.1
        run: npm install -g npm@latest
      - run: npm ci
      - run: npm run typecheck && npm test
      - name: Verify tag matches version
        run: |
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          PKG_VERSION="$(node -p "require('./package.json').version")"
          [ "$TAG_VERSION" = "$PKG_VERSION" ] || { echo "::error::tag/version mismatch"; exit 1; }
      - run: npm publish --provenance --access public
```

**`.github/workflows/ci.yml`**（可选，push/PR 自动验证）：

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
      - run: npm ci
      - run: npm run typecheck && npm test && npm run build
      - name: Pack sanity
        run: |
          npm pack --dry-run 2>&1 | tee /tmp/pack.txt
          grep -q 'lib/index.js' /tmp/pack.txt
          grep -q 'LICENSE' /tmp/pack.txt
```

## 3. 发版流程（每次）

```sh
npm version patch|minor|major && git push origin main --tags
```

CI 自动：`npm ci` → typecheck + 测试 → tag/版本一致性校验 → `npm publish --provenance`
（npm 自动用 GitHub Actions OIDC 令牌交换短期 registry 凭据，无需任何 npm secret）。

## 4. 验证

```sh
npm view <name> versions                     # 新版本出现
npm view <name> dist-tags.latest
# provenance：registry attestation API（SLSA v1）
curl -s "https://registry.npmjs.org/-/npm/v1/attestations/<name>@<version>" | jq .attestations
# 用户安装（dsh 生态最终形态）
dsh plugin --profile web add <name>
```

## 参考

- npm 官方 Trusted Publishing 文档：https://docs.npmjs.com/trusted-publishers
- 已跑通先例（同模式双面插件）：https://github.com/SiriLee/dsh-edit-approval
