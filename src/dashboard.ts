import { createServer, type IncomingMessage, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  checkBridgeEnvironment,
  commitTask,
  createCodexPrompt,
  createGithubPackage,
  createSnapshot,
  createTask,
  getBridgeStatus,
  publishTaskToGithub,
  rollbackTask
} from './commands.js';
import { getDiffStat } from './git.js';

export type DashboardServerOptions = {
  cwd: string;
  port: number;
  host?: string;
};

export type DashboardServer = {
  url: string;
  close: () => Promise<void>;
};

type Artifact = {
  path: string;
  content: string;
} | null;

type PipelineStep = {
  id: string;
  label: string;
  state: 'todo' | 'ready' | 'done';
  detail: string;
};

export async function createDashboardServer(options: DashboardServerOptions): Promise<DashboardServer> {
  const host = options.host ?? '127.0.0.1';
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/' || request.url === '/index.html') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(renderDashboardHtml());
        return;
      }

      if (request.url === '/api/state') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(await readDashboardState(options.cwd), null, 2));
        return;
      }

      if (request.method === 'POST' && request.url?.startsWith('/api/actions/')) {
        const action = request.url.slice('/api/actions/'.length);
        const result = await runDashboardAction(options.cwd, action, await readJsonBody(request));
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(result, null, 2));
        return;
      }

      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await listen(server, options.port, host);
  const address = server.address() as AddressInfo;

  return {
    url: `http://${host}:${address.port}`,
    close: () => close(server)
  };
}

async function runDashboardAction(cwd: string, action: string, body: Record<string, unknown>) {
  let message: string;

  if (action === 'create-task') {
    await createTask({
      cwd,
      title: requiredString(body.title, '任务标题不能为空'),
      description: requiredString(body.description, '任务说明不能为空'),
      checkout: body.checkout !== false
    });
    message = '任务已创建';
  } else if (action === 'codex-prompt') {
    await createCodexPrompt({
      cwd,
      verifyCommand: optionalString(body.verifyCommand)
    });
    message = 'Codex 执行提示已生成';
  } else if (action === 'snapshot') {
    await createSnapshot({
      cwd,
      verifyCommand: optionalString(body.verifyCommand)
    });
    message = 'Snapshot 已生成';
  } else if (action === 'commit') {
    await commitTask({ cwd });
    message = '本地提交已完成';
  } else if (action === 'rollback') {
    await rollbackTask({
      cwd,
      force: body.force === true
    });
    message = '任务已回滚';
  } else if (action === 'github-package') {
    await createGithubPackage({
      cwd,
      base: optionalString(body.base)
    });
    message = 'GitHub 交接包已生成';
  } else if (action === 'github-publish') {
    await publishTaskToGithub({
      cwd,
      base: optionalString(body.base)
    });
    message = 'GitHub PR 已发布';
  } else {
    throw new Error(`未知操作：${action}`);
  }

  return {
    ok: true,
    message,
    state: await readDashboardState(cwd)
  };
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(message);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy(new Error('请求体过大'));
      }
    });
    request.on('error', reject);
    request.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch {
        reject(new Error('请求 JSON 格式不正确'));
      }
    });
  });
}

async function readDashboardState(cwd: string) {
  const status = await getBridgeStatus({ cwd });
  const task = status.activeTask;
  const codex = task ? await readOptionalArtifact(cwd, task.id, 'codex-prompt.md') : null;
  const latestSnapshot = status.latestSnapshotPath
    ? {
        path: status.latestSnapshotPath,
        content: await readFile(status.latestSnapshotPath, 'utf8')
      }
    : null;
  const github = task ? await readOptionalArtifact(cwd, task.id, 'github-pr-package.md') : null;
  const environment = await checkBridgeEnvironment({ cwd });
  const onlyGithubPackageDirty = task ? isOnlyGithubPackageDirty(status.statusShort, task.id) : false;
  const hasCodeChanges = status.isDirty && !onlyGithubPackageDirty;
  const pipeline = buildPipeline(Boolean(task), Boolean(codex), hasCodeChanges, Boolean(latestSnapshot), task?.status, Boolean(github));

  return {
    status,
    workspace: {
      hasCodeChanges,
      label: status.isDirty ? onlyGithubPackageDirty ? '仅交接包未提交' : '有未提交改动' : '干净'
    },
    stage: buildStage(pipeline, Boolean(github)),
    pipeline,
    environment,
    diffStat: (await getDiffStat(cwd)) || 'no diff',
    latestSnapshot,
    handoffs: {
      codex,
      chatgpt: latestSnapshot
        ? {
            path: latestSnapshot.path,
            content: [
              '请基于这个 snapshot 评审 Codex 修改，重点看风险、遗漏测试和回滚风险。',
              '',
              latestSnapshot.content
            ].join('\n')
          }
        : null,
      github
    },
    commands: {
      codexPrompt: 'wcb codex prompt --verify "npm test -- --run"',
      snapshot: 'wcb snapshot --verify "npm test -- --run"',
      commit: 'wcb commit',
      rollback: 'wcb rollback --force',
      githubPackage: 'wcb github package --base main',
      githubPublish: 'wcb github publish --base main'
    }
  };
}

async function readOptionalArtifact(cwd: string, taskId: string, filename: string): Promise<Artifact> {
  const artifactPath = path.join(cwd, '.webcodexbridge', 'tasks', taskId, filename);
  try {
    return {
      path: artifactPath,
      content: await readFile(artifactPath, 'utf8')
    };
  } catch {
    return null;
  }
}

function buildPipeline(
  hasTask: boolean,
  hasCodexPrompt: boolean,
  isDirty: boolean,
  hasSnapshot: boolean,
  taskStatus: string | undefined,
  hasGithubPackage: boolean
): PipelineStep[] {
  return [
    {
      id: 'task',
      label: '创建任务',
      state: hasTask ? 'done' : 'ready',
      detail: hasTask ? '任务已创建' : '先创建一个任务'
    },
    {
      id: 'codex-prompt',
      label: '生成 Codex 执行提示',
      state: hasCodexPrompt ? 'done' : hasTask ? 'ready' : 'todo',
      detail: hasCodexPrompt ? '执行提示已准备' : '把任务交接给 Codex'
    },
    {
      id: 'codex-work',
      label: 'Codex 修改代码',
      state: isDirty || hasSnapshot || taskStatus === 'committed' ? 'done' : hasCodexPrompt ? 'ready' : 'todo',
      detail: isDirty ? '工作区已有改动' : hasSnapshot || taskStatus === 'committed' ? '已有执行结果' : '等待本地代码改动'
    },
    {
      id: 'snapshot',
      label: '生成 snapshot',
      state: hasSnapshot ? 'done' : isDirty ? 'ready' : 'todo',
      detail: hasSnapshot ? '已有结果包' : '记录 diff 和验证结果'
    },
    {
      id: 'commit',
      label: '本地提交',
      state: taskStatus === 'committed' ? 'done' : hasSnapshot ? 'ready' : 'todo',
      detail: taskStatus === 'committed' ? '任务已本地提交' : '把结果写入 Git 账本'
    },
    {
      id: 'github',
      label: 'GitHub 交接 / PR',
      state: hasGithubPackage ? 'ready' : taskStatus === 'committed' ? 'ready' : 'todo',
      detail: hasGithubPackage ? '交接包已生成，可复制给 ChatGPT 或发布 PR' : '生成 PR 交接包'
    }
  ];
}

function isOnlyGithubPackageDirty(statusShort: string, taskId: string): boolean {
  if (!statusShort) {
    return false;
  }

  const allowedPath = `.webcodexbridge/tasks/${taskId}/github-pr-package.md`;
  return statusShort
    .split('\n')
    .filter(Boolean)
    .every((line) => line.slice(3) === allowedPath);
}

function buildStage(pipeline: PipelineStep[], hasGithubPackage: boolean) {
  const readyStep = pipeline.find((step) => step.state === 'ready');
  if (hasGithubPackage) {
    return {
      id: 'github-ready',
      label: '可交给 GitHub / ChatGPT',
      nextAction: '复制 GitHub 交接包，或在 GitHub 环境可用后发布 PR。'
    };
  }

  if (!readyStep) {
    return {
      id: 'complete',
      label: '任务闭环已完成',
      nextAction: '可以开始下一个任务。'
    };
  }

  const nextByStep: Record<string, string> = {
    task: '创建任务，把 ChatGPT 的任务说明写入 Bridge。',
    'codex-prompt': '生成 Codex 执行提示，然后交给 Codex 修改代码。',
    'codex-work': '让 Codex 在当前任务分支上执行修改。',
    snapshot: '生成 snapshot，交给 ChatGPT 评审。',
    commit: '确认 snapshot 后进行本地提交。',
    github: '生成 GitHub 交接包，或发布 PR。'
  };

  return {
    id: readyStep.id,
    label: readyStep.label,
    nextAction: nextByStep[readyStep.id]
  };
}

function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>WebCodexBridge 任务驾驶舱</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #17201b;
        --muted: #66736b;
        --line: #d6ded8;
        --panel: #ffffff;
        --page: #f4f7f1;
        --accent: #0f7a5f;
        --warn: #9a4f16;
        --soft: #e8efe9;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        background: var(--page);
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      main {
        max-width: 1240px;
        margin: 0 auto;
        padding: 28px;
      }

      header {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 20px;
        padding-bottom: 18px;
        border-bottom: 1px solid var(--line);
      }

      h1 {
        margin: 0;
        font-size: 28px;
        line-height: 1.1;
      }

      h2 {
        margin: 0 0 12px;
        font-size: 16px;
      }

      .subtitle, .label {
        color: var(--muted);
        font-size: 13px;
      }

      .subtitle { margin: 8px 0 0; }

      .status-grid {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 12px;
        margin: 22px 0;
      }

      .metric, .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
      }

      .metric {
        min-height: 92px;
        padding: 14px;
      }

      .value {
        margin-top: 8px;
        overflow-wrap: anywhere;
        font-size: 17px;
        font-weight: 700;
      }

      .stage {
        margin: 18px 0;
        padding: 18px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--soft);
      }

      .stage strong {
        display: block;
        margin-bottom: 6px;
        font-size: 20px;
      }

      .operation {
        margin: 22px 0;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
      }

      .operation-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }

      .form-grid {
        display: grid;
        grid-template-columns: minmax(220px, 0.8fr) minmax(260px, 1.2fr);
        gap: 10px;
      }

      label {
        display: grid;
        gap: 6px;
        color: var(--muted);
        font-size: 13px;
        font-weight: 700;
      }

      input, textarea {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #fbfcfa;
        color: var(--ink);
        font: inherit;
        font-size: 14px;
        padding: 10px;
      }

      textarea {
        min-height: 74px;
        resize: vertical;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }

      button {
        min-height: 38px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #f8faf6;
        color: var(--ink);
        padding: 8px 11px;
        font: inherit;
        font-weight: 800;
        cursor: pointer;
      }

      button.primary {
        background: var(--accent);
        border-color: var(--accent);
        color: #fff;
      }

      button.danger {
        background: #fff7f0;
        border-color: #dfb38d;
        color: #8b3d10;
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }

      .result {
        min-height: 20px;
        color: var(--muted);
        font-size: 13px;
        font-weight: 700;
      }

      .result.ok { color: var(--accent); }
      .result.error { color: #a32d18; }

      .layout {
        display: grid;
        grid-template-columns: minmax(0, 0.9fr) minmax(360px, 1.1fr);
        gap: 16px;
      }

      .panel {
        padding: 16px;
      }

      .pipeline {
        display: grid;
        gap: 10px;
      }

      .step {
        display: grid;
        grid-template-columns: 76px minmax(0, 1fr);
        gap: 12px;
        align-items: start;
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fbfcfa;
      }

      .badge {
        display: inline-flex;
        justify-content: center;
        min-width: 58px;
        padding: 4px 8px;
        border-radius: 999px;
        color: #fff;
        font-size: 12px;
        font-weight: 700;
      }

      .badge.done { background: var(--accent); }
      .badge.ready { background: var(--warn); }
      .badge.todo { background: #78837b; }

      .tabs {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
      }

      .tab {
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #f8faf6;
        color: var(--ink);
        padding: 8px 10px;
        font-weight: 700;
        cursor: pointer;
      }

      .tab.active {
        background: var(--accent);
        border-color: var(--accent);
        color: #fff;
      }

      pre, code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }

      pre {
        margin: 0;
        min-height: 420px;
        max-height: 62vh;
        overflow: auto;
        white-space: pre-wrap;
        color: #24332a;
        font-size: 13px;
        line-height: 1.5;
      }

      code {
        display: block;
        margin-top: 8px;
        padding: 10px;
        overflow-wrap: anywhere;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #f8faf6;
      }

      .dirty { color: var(--warn); }
      .clean { color: var(--accent); }

      @media (max-width: 900px) {
        main { padding: 18px; }
        header, .layout, .form-grid { display: block; }
        .status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .panel { margin-top: 14px; }
        label + label { margin-top: 10px; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>WebCodexBridge 任务驾驶舱</h1>
          <p class="subtitle">ChatGPT 负责思考，Codex 负责执行，Bridge 负责状态、审计和回滚。</p>
        </div>
        <div class="label">数据源：<code>/api/state</code></div>
      </header>

      <section class="stage" aria-label="下一步">
        <strong id="stageLabel">loading</strong>
        <div id="stageAction">loading</div>
      </section>

      <section class="status-grid" aria-label="状态概览">
        <div class="metric"><div class="label">当前任务</div><div class="value" id="task">loading</div></div>
        <div class="metric"><div class="label">当前分支</div><div class="value" id="branch">loading</div></div>
        <div class="metric"><div class="label">工作区</div><div class="value" id="dirty">loading</div></div>
        <div class="metric"><div class="label">GitHub</div><div class="value" id="githubReady">loading</div></div>
        <div class="metric"><div class="label">最新快照</div><div class="value" id="snapshot">loading</div></div>
      </section>

      <section class="operation" aria-label="网页操作台">
        <div class="operation-head">
          <h2>网页操作台</h2>
          <div class="result" id="actionResult">准备就绪</div>
        </div>
        <form id="actionForm">
          <div class="form-grid">
            <label>
              任务标题
              <input name="title" autocomplete="off" placeholder="例如：完善操作说明">
            </label>
            <label>
              任务说明
              <textarea name="description" placeholder="写清楚目标、边界和验收方式"></textarea>
            </label>
            <label>
              验证命令
              <input name="verifyCommand" value="npm test -- --run">
            </label>
            <label>
              GitHub 目标分支
              <input name="base" value="main">
            </label>
          </div>
        </form>
        <div class="actions">
          <button class="primary" data-action="create-task">创建任务</button>
          <button data-action="codex-prompt">生成 Codex 提示</button>
          <button data-action="snapshot">生成 snapshot</button>
          <button data-action="commit">本地提交</button>
          <button data-action="github-package">生成 GitHub 交接包</button>
          <button data-action="github-publish">发布 PR</button>
          <button class="danger" data-action="rollback">回滚</button>
          <button data-action="refresh">刷新</button>
        </div>
      </section>

      <section class="layout">
        <div class="panel">
          <h2>任务流水线</h2>
          <div class="pipeline" id="pipeline">loading</div>
          <h2 style="margin-top:18px">Git Diff Stat</h2>
          <pre id="diffStat" style="min-height:120px;max-height:180px">loading</pre>
        </div>
        <div class="panel">
          <h2>交接内容</h2>
          <div class="tabs">
            <button class="tab active" data-tab="codex">给 Codex</button>
            <button class="tab" data-tab="chatgpt">给 ChatGPT</button>
            <button class="tab" data-tab="github">给 GitHub</button>
            <button class="tab" id="copyHandoff" type="button">复制</button>
          </div>
          <pre id="handoffContent">loading</pre>
        </div>
      </section>
    </main>

    <script>
      let dashboardState;
      let activeTab = 'codex';

      loadState();

      document.querySelectorAll('.tab').forEach((button) => {
        button.addEventListener('click', () => {
          if (!button.dataset.tab) return;
          activeTab = button.dataset.tab;
          document.querySelectorAll('.tab[data-tab]').forEach((tab) => tab.classList.remove('active'));
          button.classList.add('active');
          renderHandoff();
        });
      });

      document.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.dataset.action;
          if (action === 'refresh') {
            loadState();
            return;
          }
          runAction(action);
        });
      });

      document.getElementById('copyHandoff').addEventListener('click', async () => {
        const content = document.getElementById('handoffContent').textContent || '';
        await navigator.clipboard.writeText(content);
        setResult('已复制交接内容', 'ok');
      });

      async function loadState() {
        try {
          const response = await fetch('/api/state');
          dashboardState = await response.json();
          render(dashboardState);
        } catch (error) {
          document.getElementById('handoffContent').textContent = error.message;
          setResult(error.message, 'error');
        }
      }

      async function runAction(action) {
        if (action === 'rollback' && !confirm('确认回滚当前任务？这会丢弃未提交代码改动。')) {
          return;
        }

        setBusy(true);
        setResult('执行中...', '');
        try {
          const response = await fetch('/api/actions/' + action, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(actionBody(action))
          });
          const result = await response.json();
          if (!response.ok || result.error) {
            throw new Error(result.error || '操作失败');
          }
          dashboardState = result.state;
          render(dashboardState);
          setResult(result.message, 'ok');
        } catch (error) {
          setResult(error.message, 'error');
        } finally {
          setBusy(false);
        }
      }

      function actionBody(action) {
        const form = new FormData(document.getElementById('actionForm'));
        if (action === 'create-task') {
          return {
            title: form.get('title'),
            description: form.get('description'),
            checkout: true
          };
        }
        if (action === 'codex-prompt' || action === 'snapshot') {
          return { verifyCommand: form.get('verifyCommand') };
        }
        if (action === 'github-package' || action === 'github-publish') {
          return { base: form.get('base') };
        }
        if (action === 'rollback') {
          return { force: true };
        }
        return {};
      }

      function render(state) {
        document.getElementById('stageLabel').textContent = state.stage.label;
        document.getElementById('stageAction').textContent = state.stage.nextAction;
        document.getElementById('branch').textContent = state.status.branch || 'unknown';
        const dirty = document.getElementById('dirty');
        dirty.textContent = state.workspace.label;
        dirty.className = state.workspace.hasCodeChanges ? 'value dirty' : 'value clean';
        document.getElementById('task').textContent = state.status.activeTask ? state.status.activeTask.title : '无 active task';
        document.getElementById('snapshot').textContent = state.latestSnapshot ? state.latestSnapshot.path : '无';
        document.getElementById('githubReady').textContent = state.handoffs.github ? '交接包已就绪' : state.environment.readyForGithub ? '可发布 PR' : '先生成交接包';
        document.getElementById('diffStat').textContent = state.diffStat;
        document.getElementById('pipeline').innerHTML = state.pipeline.map((step) => (
          '<div class="step">' +
            '<span class="badge ' + step.state + '">' + stateLabel(step.state) + '</span>' +
            '<div><strong>' + escapeHtml(step.label) + '</strong><div class="label">' + escapeHtml(step.detail) + '</div></div>' +
          '</div>'
        )).join('');
        updateActionAvailability(state);
        renderHandoff();
      }

      function updateActionAvailability(state) {
        const hasTask = Boolean(state.status.activeTask);
        const hasSnapshot = Boolean(state.latestSnapshot);
        const hasGithubPackage = Boolean(state.handoffs.github);
        setActionDisabled('create-task', hasTask);
        setActionDisabled('codex-prompt', !hasTask);
        setActionDisabled('snapshot', !hasTask);
        setActionDisabled('commit', !hasTask || !hasSnapshot);
        setActionDisabled('github-package', !hasTask || !hasSnapshot);
        setActionDisabled('github-publish', !hasTask || !hasSnapshot || !state.environment.readyForGithub);
        setActionDisabled('rollback', !hasTask);
      }

      function setActionDisabled(action, disabled) {
        const button = document.querySelector('[data-action="' + action + '"]');
        if (button) button.disabled = disabled;
      }

      function setBusy(isBusy) {
        document.querySelectorAll('[data-action]').forEach((button) => {
          if (isBusy) {
            button.dataset.wasDisabled = String(button.disabled);
            button.disabled = true;
          } else {
            button.disabled = button.dataset.wasDisabled === 'true';
          }
        });
      }

      function setResult(message, kind) {
        const result = document.getElementById('actionResult');
        result.textContent = message;
        result.className = kind ? 'result ' + kind : 'result';
      }

      function renderHandoff() {
        if (!dashboardState) return;
        const handoff = dashboardState.handoffs[activeTab];
        const fallback = {
          codex: dashboardState.commands.codexPrompt,
          chatgpt: '先运行 ' + dashboardState.commands.snapshot,
          github: dashboardState.commands.githubPackage
        };
        document.getElementById('handoffContent').textContent = handoff ? handoff.content : fallback[activeTab];
      }

      function stateLabel(state) {
        return state === 'done' ? '完成' : state === 'ready' ? '可执行' : '未开始';
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;');
      }
    </script>
  </body>
</html>`;
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
