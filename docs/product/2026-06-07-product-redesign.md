# WebCodexBridge 产品重新设计

## 设计目标

WebCodexBridge 不应该只是命令集合。它应该是一个本地 AI 编程任务驾驶舱，让用户清楚知道：

- 当前任务处于哪一步；
- ChatGPT 现在该做什么；
- Codex 现在该做什么；
- 本地 Git 是否安全；
- 哪些内容可以交给 GitHub/ChatGPT 审计；
- 出问题时如何回滚。

产品要减少“我现在该去哪里操作”的困惑，而不是增加一个新的工具切换点。

## 核心产品形态

推荐形态：**浏览器驾驶舱为主，CLI 为底层能力。**

用户主要打开：

```bash
wcb serve
```

然后在浏览器里完成日常判断和复制动作。CLI 仍然存在，但它更像底层引擎和高级用户入口。

### 三个操作平面

1. **ChatGPT：思考与评审平面**
   - 用来讨论需求、拆任务、评审 PR/snapshot。
   - 不负责本地 Git 操作。

2. **Codex：执行平面**
   - 用来修改本地代码、跑测试、修复问题。
   - 不负责判断任务流程是否安全。

3. **Bridge：控制平面**
   - 负责状态、分支、snapshot、提交、回滚、GitHub 交接包。
   - 告诉用户下一步应该去 ChatGPT、Codex、GitHub 还是本地执行。

## 用户心智模型

产品应该围绕“任务”而不是“命令”设计。

每个任务是一条可追踪流水线：

```text
任务输入
  -> Codex 执行提示
  -> 本地代码修改
  -> 验证与 snapshot
  -> 本地提交
  -> GitHub 交接包 / PR
  -> ChatGPT 评审
  -> 继续修改或结束
```

用户不需要记住所有命令。Bridge 应该始终显示：

- 当前阶段；
- 阶段是否完成；
- 下一步主操作；
- 可以复制给 ChatGPT/Codex/GitHub 的内容；
- 危险操作是否可用。

## 浏览器驾驶舱设计

### 顶部：任务状态条

显示：

- 当前任务标题；
- 当前分支；
- 工作区是否干净；
- base commit；
- 最新 snapshot；
- GitHub 状态：未配置 / 可生成交接包 / 可发布 PR / 已发布。

状态语言必须是中文、人话，不要只显示 raw Git 输出。

示例：

```text
当前任务：修复登录错误
阶段：等待 Codex 执行
分支：wb/fix-login
工作区：有未提交改动
下一步：生成 snapshot，交给 ChatGPT 评审
```

### 中间：任务流水线

用 6 个明确步骤替代散落命令：

1. 创建任务
2. 生成 Codex 执行提示
3. Codex 修改代码
4. 生成 snapshot
5. 本地提交
6. 生成 GitHub 交接包 / 发布 PR

每一步显示三种状态：

- 未开始；
- 可执行；
- 已完成。

每一步只放一个主按钮或复制块，避免让用户面对多个同等重量的选择。

### 右侧：交接内容

这是产品最关键的区域，分成三个标签页：

1. **给 Codex**
   - 显示 `codex-prompt.md` 内容；
   - 一键复制；
   - 显示“已在任务分支，不要改 main”。

2. **给 ChatGPT**
   - 显示 snapshot 摘要；
   - 显示建议提问：
     ```text
     请基于这个 snapshot 评审 Codex 修改，重点看风险、遗漏测试和回滚风险。
     ```

3. **给 GitHub**
   - 显示 PR 标题；
   - 显示 PR body 文件；
   - 显示 `git push` 和 `gh pr create` 命令；
   - 如果 `gh` 或 remote 缺失，显示具体缺什么。

## CLI 重新分层

CLI 不应该让用户从一堆命令里猜流程。建议分成三类：

### 任务命令

```bash
wcb task create
wcb task status
```

### 交接命令

```bash
wcb codex prompt
wcb snapshot
wcb github package
```

### 安全命令

```bash
wcb commit
wcb rollback
wcb doctor
```

现有命令可以保留，但文档和 Dashboard 应该按这三类展示。

## 推荐默认流程

第一屏不应该让用户先读说明，而应该让用户立刻进入任务：

```text
没有 active task：
  主按钮：创建任务
  次按钮：检查环境

有 active task 但没有 Codex prompt：
  主按钮：生成 Codex 执行提示

有 Codex prompt 但没有 snapshot：
  主按钮：生成 snapshot

有 snapshot 但未提交：
  主按钮：本地提交
  次按钮：复制给 ChatGPT 评审

已提交：
  主按钮：生成 GitHub 交接包
  次按钮：发布 GitHub PR
```

## 容易用的关键细节

### 1. 少让用户切换上下文

Bridge 页面必须直接提供可复制内容：

- 给 Codex 的 prompt；
- 给 ChatGPT 的评审提示；
- 给 GitHub 的 PR 命令。

用户只在必要时切换 App，而不是自己拼材料。

### 2. 所有危险操作先解释后执行

回滚、提交、发布 PR 都需要显示：

- 将影响什么；
- 是否会丢弃改动；
- 是否已保存 snapshot；
- 是否能回到 base commit。

### 3. 用阶段语言替代工具语言

不要只显示：

```text
Dirty: yes
Latest snapshot: none
```

应该显示：

```text
工作区有未提交改动。请先生成 snapshot，再决定提交或回滚。
```

### 4. GitHub 不可用时也给替代路径

如果 `gh` 未安装或没有 remote：

- 不要只报错；
- 显示 `wcb github package`；
- 告诉用户当前可以先生成交接包，等 GitHub 配好再发布 PR。

### 5. 中文优先

用户明确偏好中文文档和 Git commit message。产品界面、交接包、默认提示也应该中文优先。Git 命令本身保持英文。

## 应该避免的产品方向

### 不建议把 ChatGPT 做成主操作界面

ChatGPT 适合思考和评审，但不适合承担本地状态控制。它看不到完整本地环境，也不应该负责回滚和提交。

### 不建议把 Codex 做成主操作界面

Codex 适合执行，但如果所有流程都靠 Codex 对话推进，用户很难审计当前状态，也容易忘记 snapshot、commit、PR。

### 不建议第一版做 GitHub App/Webhook

GitHub App 是后续增强，不是第一版的易用性核心。第一版最重要的是让个人本地闭环顺滑。

## 下一轮实现建议

优先实现这 4 个改动：

1. **Dashboard 改成任务流水线**
   - 6 步状态；
   - 每步一个主操作；
   - 显示下一步建议。

2. **Dashboard 增加交接标签页**
   - 给 Codex；
   - 给 ChatGPT；
   - 给 GitHub。

3. **增加 Dashboard API**
   - 返回 codex prompt 内容；
   - 返回 GitHub package 内容；
   - 返回环境诊断；
   - 返回任务阶段。

4. **补本机安装方式**
   - README 明确 `npm run build && npm link`；
   - 或提供 `npm run install:local`。

## 设计判断

WebCodexBridge 的易用性不来自更多自动化，而来自更清楚的控制感。

用户应该随时知道：

- 我在哪个任务；
- 我在哪个分支；
- 我下一步该交给谁；
- 我有什么证据；
- 我怎么撤回。

这才是“ChatGPT 负责思考，Codex 负责执行，Bridge 负责闭环”的产品形态。
