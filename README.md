# WebCodexBridge

WebCodexBridge 是一个本地 AI 编程控制层。

它的目标是让评审 AI 负责思考和评审，让执行 Agent 负责本地代码执行，让 Git 负责审计、回滚和复用。

> [!IMPORTANT]
> **安全运行提示**：
> 请**不要**直接在 `WebCodexBridge` 工具本身的源码仓库（或其子目录下）运行指令做业务开发。
> 否则会导致您的业务代码和提交历史与工具自身代码混淆在一起。请在运行前阅读下方的 [推荐目录结构与多项目管理](#推荐目录结构与多项目管理) 指南。

## 产品形态

推荐操作界面是本地浏览器任务驾驶舱：

```bash
wcb serve --port 8787
```

CLI 是底层能力和高级入口：

```bash
wcb init
wcb doctor
wcb task create --title "修复登录错误" --description "..." --checkout
wcb codex prompt --verify "npm test -- --run"
wcb status
wcb snapshot --verify "npm test -- --run"
wcb commit
wcb rollback --force
wcb serve --port 8787
wcb github package --base main
wcb github publish --base main
```

职责划分：

- 评审 AI：思考任务、拆解需求、评审结果。
- 执行 Agent：在本地项目里执行代码修改。
- WebCodexBridge：管理任务、分支、状态、快照、提交和回滚。
- Git：作为本地审计账本和回滚锚点。
- GitHub：作为评审 AI 和本地执行结果之间的共享状态层。

浏览器任务驾驶舱复用同一套命令能力，展示任务流水线、当前阶段、下一步位置，并提供阶段主按钮来突出当前最重要动作。更多操作仍然保留在网页操作台里，用来创建任务、生成执行提示、生成 snapshot、本地提交、回滚，以及生成 GitHub 交接包 / 发布 PR。

详细日常流程见：[docs/操作说明.md](docs/操作说明.md)。

网页操作台也可以完成 GitHub 发布准备：先在 GitHub 创建仓库，然后在 `GitHub 发布` 区域填入 remote URL，点击设置 remote、推送 base 与任务分支，再打开 PR 页面。如果浏览器没有登录 GitHub，按 GitHub 页面提示登录授权；命令行发布则需要安装 GitHub CLI 并运行 `gh auth login`。

## 推荐目录结构与多项目管理

为了保持 WebCodexBridge 工具本身的整洁，并防止业务项目的开发或 Git 提交混入工具仓库中，**强烈建议不要在工具源码仓库内直接创建新项目**。

推荐使用如下物理隔离的目录结构：

```text
AIWorkspaces/
  GPTCodexBridge/        # WebCodexBridge 工具源码目录
  project-a/             # 独立的业务项目 A (Git 仓库)
  project-b/             # 独立的业务项目 B (Git 仓库)
```

### 多项目管理用法

1. **直接进入项目目录操作**（推荐）：
   ```bash
   cd ~/AIWorkspaces/project-a
   wcb init
   wcb serve --port 8787
   ```

2. **使用 `--project` 参数定向操作**：
   无需切换目录，即可在任意位置指定目标项目：
   ```bash
   wcb --project ~/AIWorkspaces/project-a serve
   wcb --project ~/AIWorkspaces/project-b snapshot
   ```

3. **开发 Bridge 工具自身**：
   如需使用 Bridge 协作开发 Bridge 自身，必须使用 `--internal-dogfood` 参数绕过安全拦截限制：
   ```bash
   wcb --internal-dogfood task create --title "..." --description "..."
   wcb --internal-dogfood serve
   ```

## 本地 Git 闭环

1. 在评审 AI 中讨论任务。
2. 使用 WebCodexBridge 创建本地任务和任务分支。
3. 使用 `wcb codex prompt` 生成给执行 Agent 的执行提示。
4. 让执行 Agent 在该分支上修改代码。
5. 使用 `wcb snapshot` 生成包含 Git 状态、diff 和验证输出的结果包。
6. 结果可接受时，使用 `wcb commit` 本地提交。
7. 任务需要丢弃时，使用 `wcb rollback --force` 回到任务 base commit。
8. 需要可视化查看时，使用 `wcb serve --port 8787` 打开本地浏览器控制台。

## GitHub 共享状态层

发布前可以先检查环境：

```bash
wcb doctor
```

它会检查：

- Git CLI；
- 当前目录是否是 Git 仓库；
- GitHub CLI；
- `origin` remote。

本地闭环稳定后，可以使用：

```bash
wcb github package --base main
wcb github publish --base main
```

`wcb github package` 会先生成一个可复制、可审计、可复用的 GitHub PR 交接包，包含 PR 标题、PR body 文件、发布命令和给评审 AI 的评审提示。

`wcb github publish` 会：

1. 要求当前任务存在最新 snapshot；
2. 要求本地工作区已经提交或清理干净；
3. 执行 `git push -u origin <task-branch>`；
4. 执行 `gh pr create --base <base> --head <task-branch> --title <任务标题> --body-file <latest-snapshot>`。

这样 GitHub PR 就会承载任务目标、执行 Agent 执行结果、diff、验证输出和后续评审 AI 评审讨论。

## 开发

```bash
npm install
npm test -- --run
npm run build
```

本机使用：

```bash
npm run build
npm link
wcb doctor
wcb serve --port 8787
```
