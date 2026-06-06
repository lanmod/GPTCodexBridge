# 本地 Git 管理实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 WebCodexBridge 本地 CLI，管理 Git 任务分支、任务元数据、snapshot、提交、受保护回滚和 GitHub PR 发布。

**Architecture:** CLI 是一个小型 Node.js/TypeScript 应用。它把元数据写入 `.webcodexbridge/`，封装本地 Git 命令，并提供 `doctor`、`init`、`task create`、`codex prompt`、`status`、`snapshot`、`commit`、`rollback`、`serve`、`github package`、`github publish` 命令。

**Tech Stack:** Node.js、TypeScript、Vitest、本地 Git CLI、GitHub CLI、Node HTTP server。

---

### Task 1: 项目脚手架与 init 命令

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types.ts`
- Create: `src/git.ts`
- Create: `src/task-store.ts`
- Create: `src/commands.ts`
- Create: `src/cli.ts`
- Create: `tests/helpers.ts`
- Create: `tests/init.test.ts`

- [x] 写一个失败测试：在临时 Git 仓库中运行 `initBridge()`，期待生成 `.webcodexbridge/config.json` 和 `.webcodexbridge/tasks/`。
- [x] 运行 `npm test -- init.test.ts --run`，确认测试因为源文件缺失而失败。
- [x] 添加最小项目脚手架和 `initBridge()` 实现。
- [x] 运行 `npm test -- init.test.ts --run`，确认测试通过。

### Task 2: 任务创建

**Files:**
- Modify: `src/task-store.ts`
- Modify: `src/commands.ts`
- Modify: `src/cli.ts`
- Create: `tests/task-create.test.ts`

- [x] 写一个失败测试：创建任务后，任务元数据包含 title、description、base branch、base commit、`wb/<slug>` 分支名。
- [x] 写一个失败测试：`checkout: true` 时真的创建并切换 Git 分支。
- [x] 实现 slug 生成、task id 生成、任务持久化和可选分支 checkout。
- [x] 运行 `npm test -- task-create.test.ts --run`，确认测试通过。

### Task 3: Status 与 Snapshot

**Files:**
- Modify: `src/git.ts`
- Modify: `src/task-store.ts`
- Modify: `src/commands.ts`
- Modify: `src/cli.ts`
- Create: `tests/status-snapshot.test.ts`

- [x] 写一个失败测试：`getBridgeStatus()` 返回 branch、dirty state 和 active task。
- [x] 写一个失败测试：`createSnapshot()` 写入 Markdown，包含 task title、Git status、diff stat、完整 diff 和验证结果。
- [x] 实现 status 与 snapshot 命令。
- [x] 运行 `npm test -- status-snapshot.test.ts --run`，确认测试通过。

### Task 4: Commit 与 Rollback

**Files:**
- Modify: `src/git.ts`
- Modify: `src/task-store.ts`
- Modify: `src/commands.ts`
- Modify: `src/cli.ts`
- Create: `tests/commit-rollback.test.ts`

- [x] 写一个失败测试：没有改动时 `commitTask()` 拒绝提交。
- [x] 写一个失败测试：`commitTask()` stage 改动、创建中文 commit message，并更新任务状态。
- [x] 写一个失败测试：`rollbackTask()` 在工作区有未提交改动且没有 `force` 时拒绝。
- [x] 写一个失败测试：强制 rollback 回到任务 base commit，并更新任务状态。
- [x] 实现 commit 与 rollback 行为。
- [x] 运行 `npm test -- commit-rollback.test.ts --run`，确认测试通过。

### Task 5: 本地浏览器控制台

**Files:**
- Create: `src/dashboard.ts`
- Modify: `src/task-store.ts`
- Modify: `src/commands.ts`
- Modify: `src/cli.ts`
- Create: `tests/dashboard.test.ts`

- [x] 写一个失败测试：`createDashboardServer()` 返回本地 HTML 页面，页面包含 WebCodexBridge 和“本地控制台”。
- [x] 写一个失败测试：`/api/state` 返回 branch、dirty state、active task、diff stat 和 latest snapshot 内容。
- [x] 实现 Node HTTP server、HTML 页面和 JSON API。
- [x] 为 CLI 添加 `wcb serve [--port 8787]`。
- [x] 使用浏览器打开本地控制台，验证页面渲染和数据加载。

### Task 6: CLI Smoke 与 Build

**Files:**
- Modify: `src/cli.ts`
- Modify: `package.json`
- Modify: `README.md`

- [x] 运行 `npm test -- --run`。
- [x] 运行 `npm run build`。
- [x] 在临时 Git 仓库里手动烟测 `node dist/cli.js init`、`task create`、`status`、`snapshot`、`commit`、`rollback` 和 `serve`。

### Task 7: GitHub PR 发布

**Files:**
- Modify: `src/types.ts`
- Modify: `src/git.ts`
- Modify: `src/commands.ts`
- Modify: `src/cli.ts`
- Modify: `src/dashboard.ts`
- Create: `tests/github.test.ts`

- [x] 写一个失败测试：`publishTaskToGithub()` 会执行 `git push -u origin <branch>`，并用 latest snapshot 调用 `gh pr create`。
- [x] 写一个失败测试：缺少 snapshot 时拒绝发布。
- [x] 写一个失败测试：工作区有未提交改动时拒绝发布。
- [x] 实现 `ToolRunner`、默认命令执行器和 GitHub publish 命令。
- [x] 为 CLI 添加 `wcb github publish [--base main]`。
- [x] 在 Dashboard 的下一步命令中展示 GitHub 发布命令。

### Task 8: 环境诊断

**Files:**
- Modify: `src/types.ts`
- Modify: `src/commands.ts`
- Modify: `src/cli.ts`
- Create: `tests/doctor.test.ts`

- [x] 写一个失败测试：缺少 `gh` 和 `origin` remote 时，`checkBridgeEnvironment()` 返回 GitHub 不可用。
- [x] 写一个失败测试：`gh` 和 `origin` 都可用时，`checkBridgeEnvironment()` 返回 GitHub 可用。
- [x] 实现 `wcb doctor` 中文诊断输出。

### Task 9: GitHub PR 交接包

**Files:**
- Modify: `src/types.ts`
- Modify: `src/commands.ts`
- Modify: `src/cli.ts`
- Modify: `src/dashboard.ts`
- Create: `tests/github-package.test.ts`

- [x] 写一个失败测试：`createGithubPackage()` 根据 latest snapshot 生成 `github-pr-package.md`。
- [x] 写一个失败测试：缺少 snapshot 时拒绝生成交接包。
- [x] 实现 `wcb github package [--base main]`。
- [x] 在 Dashboard 的下一步命令中展示 GitHub 交接包命令。

### Task 10: Codex 执行提示

**Files:**
- Modify: `src/types.ts`
- Modify: `src/commands.ts`
- Modify: `src/cli.ts`
- Modify: `src/dashboard.ts`
- Create: `tests/codex-prompt.test.ts`

- [x] 写一个失败测试：`createCodexPrompt()` 根据 active task 生成 `codex-prompt.md`。
- [x] 写一个失败测试：未传验证命令时使用默认 `npm test -- --run`。
- [x] 实现 `wcb codex prompt [--verify "..."]`。
- [x] 在 Dashboard 的下一步命令中展示 Codex 执行提示命令。
