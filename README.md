# WebCodexBridge

WebCodexBridge 是一个本地 AI 编程控制层。

它的目标是让 ChatGPT 负责思考和评审，让 Codex 负责本地代码执行，让 Git 负责审计、回滚和复用。

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

- ChatGPT：思考任务、拆解需求、评审结果。
- Codex：在本地项目里执行代码修改。
- WebCodexBridge：管理任务、分支、状态、快照、提交和回滚。
- Git：作为本地审计账本和回滚锚点。
- GitHub：作为 ChatGPT 和本地执行结果之间的共享状态层。

浏览器任务驾驶舱复用同一套命令能力，展示任务流水线、当前阶段、下一步建议，并提供网页操作台来创建任务、生成 Codex 提示、生成 snapshot、本地提交、回滚，以及生成 GitHub 交接包 / 发布 PR。

详细日常流程见：[docs/操作说明.md](docs/操作说明.md)。

## 本地 Git 闭环

1. 在 ChatGPT 中讨论任务。
2. 使用 WebCodexBridge 创建本地任务和任务分支。
3. 使用 `wcb codex prompt` 生成给 Codex 的执行提示。
4. 让 Codex 在该分支上修改代码。
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

`wcb github package` 会先生成一个可复制、可审计、可复用的 GitHub PR 交接包，包含 PR 标题、PR body 文件、发布命令和给 ChatGPT 的评审提示。

`wcb github publish` 会：

1. 要求当前任务存在最新 snapshot；
2. 要求本地工作区已经提交或清理干净；
3. 执行 `git push -u origin <task-branch>`；
4. 执行 `gh pr create --base <base> --head <task-branch> --title <任务标题> --body-file <latest-snapshot>`。

这样 GitHub PR 就会承载任务目标、Codex 执行结果、diff、验证输出和后续 ChatGPT 评审讨论。

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
