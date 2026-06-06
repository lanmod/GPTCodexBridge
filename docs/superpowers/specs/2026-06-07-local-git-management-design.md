# 本地 Git 管理设计

## 目标

把 WebCodexBridge 第一版做成本地 CLI：让 ChatGPT 的任务意图和 Codex 的本地执行，进入一个可审计、可回滚、可复用的 Git 工作流。

## 范围

这个 MVP 只聚焦本地 Git 管理。暂不创建 GitHub Pull Request，不监听 GitHub 评论，也不实现云端机器人。

CLI 需要支持：

- 初始化项目级 `.webcodexbridge/` 工作区；
- 从 ChatGPT 风格的任务说明创建本地任务记录；
- 生成给 Codex 使用的执行提示；
- 创建或建议独立的 `wb/<slug>` 任务分支；
- 展示本地任务和 Git 状态；
- 生成包含 Git 证据和验证输出的 snapshot/result package；
- 用中文 commit message 提交当前任务改动；
- 安全回滚到任务开始时记录的 base commit；
- 生成 GitHub PR 交接包；
- 使用 GitHub CLI 把任务分支发布为 PR，并把最新 snapshot 作为 PR body。

## 架构

产品是一个 Node.js 命令行应用。它把当前工作目录视为目标 Git 仓库，并把 Bridge 元数据存储在 `.webcodexbridge/` 下。

核心模块：

- `src/cli.ts`：解析命令并输出用户可读信息。
- `src/git.ts`：封装 Git 命令，返回结构化结果。
- `src/task-store.ts`：创建、读取和更新任务元数据。
- `src/commands.ts`：实现 init、task create、status、snapshot、commit、rollback。
- `src/dashboard.ts`：提供本地浏览器控制台。
- `src/types.ts`：共享类型定义。

GitHub 共享状态层通过本机 `gh` CLI 接入。第一版只做 push + PR create，不做 GitHub App、Webhook 或评论监听。

## 数据模型

`.webcodexbridge/config.json`：

```json
{
  "version": 1,
  "branchPrefix": "wb",
  "tasksDir": ".webcodexbridge/tasks"
}
```

`.webcodexbridge/tasks/<task-id>/task.json`：

```json
{
  "id": "20260607-fix-login",
  "slug": "fix-login",
  "title": "修复登录错误",
  "description": "来自 ChatGPT 的任务说明。",
  "baseBranch": "main",
  "baseCommit": "abc123",
  "branchName": "wb/fix-login",
  "status": "created",
  "createdAt": "2026-06-07T00:00:00.000Z",
  "updatedAt": "2026-06-07T00:00:00.000Z"
}
```

Snapshot 文件存储在 `.webcodexbridge/tasks/<task-id>/snapshots/<timestamp>.md`。

## 命令行为

`wcb init`

- 校验当前目录是 Git 仓库；
- 创建 `.webcodexbridge/config.json`；
- 创建 `.webcodexbridge/tasks/`；
- 不修改分支和 commit。

`wcb doctor`

- 检查 Git CLI；
- 检查当前目录是否是 Git 仓库；
- 检查 GitHub CLI；
- 检查 `origin` remote；
- 用中文输出本地 Git 闭环和 GitHub 共享状态层是否可用。

`wcb task create --title "..." --description "..."`

- 要求项目已初始化；
- 记录当前分支和 HEAD commit 作为任务 base；
- 生成安全 slug 和 task id；
- 创建分支名 `wb/<slug>`；
- 带 `--checkout` 时创建并切换到任务分支；
- 不带 `--checkout` 时只记录建议分支并输出切换命令。

`wcb codex prompt [--verify "..."]`

- 要求存在 active task；
- 在任务目录写入 `codex-prompt.md`；
- 文件包含任务说明、任务分支、base commit、执行边界和建议验证命令；
- 用于把 ChatGPT 的任务意图交接给 Codex 执行。

`wcb status`

- 展示当前 Git 分支、工作区是否有改动、active task、最新 snapshot 路径。

`wcb snapshot [--verify "command"]`

- 记录任务元数据、当前分支、`git status --short`、`git diff --stat` 和完整 `git diff`；
- 带 `--verify` 时执行命令，并记录退出码与输出；
- 写入 Markdown result package。

`wcb commit`

- 要求存在 active task；
- 没有任何改动时拒绝提交；
- stage 当前工作区改动；
- 使用中文提交信息：`任务提交：<任务标题>`；
- 将任务状态更新为 `committed`。

`wcb rollback`

- 要求存在 active task；
- 默认在工作区有未提交改动时拒绝；
- 带 `--force` 时执行 `git reset --hard <baseCommit>`；
- 将任务状态更新为 `rolled_back`。

`wcb serve`

- 启动本地浏览器控制台；
- 页面展示当前分支、工作区状态、active task、diff stat、latest snapshot；
- 不替代 CLI，只作为更直观的总控台。

`wcb github publish [--base main]`

- 要求存在 active task；
- 要求已生成最新 snapshot；
- 要求本地工作区没有未提交改动；
- 执行 `git push -u origin <task-branch>`；
- 执行 `gh pr create --base <base> --head <task-branch> --title <任务标题> --body-file <latest-snapshot>`；
- 返回 GitHub PR URL，供 ChatGPT 读取和评审。

`wcb github package [--base main]`

- 要求存在 active task；
- 要求已生成最新 snapshot；
- 在任务目录写入 `github-pr-package.md`；
- 文件包含 PR 标题、PR body 文件、发布命令和给 ChatGPT 的中文评审提示；
- 不访问网络，不修改远端。

## 安全规则

- 只有 `wcb github publish` 会 push 到远端。
- GitHub 发布前必须先生成 snapshot，并且工作区必须干净。
- rollback 必须显式触发，并默认保护未提交改动。
- snapshot 是非破坏性操作。
- 在非 Git 仓库或未初始化项目中运行时，命令必须给出清晰错误。
- 任务元数据记录 base commit，保证审计和回滚有稳定锚点。

## 测试

使用 Vitest 和临时 Git 仓库。测试覆盖初始化、任务创建、状态展示、snapshot 生成、提交行为、回滚保护，以及本地浏览器控制台。
