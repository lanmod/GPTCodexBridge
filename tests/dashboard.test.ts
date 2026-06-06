import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  commitTask,
  createCodexPrompt,
  createGithubPackage,
  createSnapshot,
  createTask,
  initBridge
} from '../src/commands.js';
import { createDashboardServer } from '../src/dashboard.js';
import { createTempGitRepo, removeTempDir } from './helpers.js';

const dirs: string[] = [];

describe('dashboard server', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(removeTempDir));
  });

  it('serves an operational dashboard page', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    await createTask({
      cwd: repo,
      title: 'Inspect browser dashboard',
      description: 'Show local Git state in the browser.',
      checkout: true
    });

    const server = await createDashboardServer({ cwd: repo, port: 0 });
    try {
      const response = await fetch(`${server.url}/`);
      const html = await response.text();

      expect(response.headers.get('content-type')).toContain('text/html');
      expect(html).toContain('WebCodexBridge');
      expect(html).toContain('任务驾驶舱');
      expect(html).toContain('/api/state');
    } finally {
      await server.close();
    }
  });

  it('serves dashboard state with git status, diff stat, and latest snapshot content', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    const task = await createTask({
      cwd: repo,
      title: 'Review local audit',
      description: 'Expose bridge evidence to the browser.',
      checkout: true
    });
    await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nDashboard change.\n');
    const snapshot = await createSnapshot({ cwd: repo, verifyCommand: 'node -e "console.log(\'dashboard ok\')"' });

    const server = await createDashboardServer({ cwd: repo, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/state`);
      const state = await response.json();

      expect(state.projectPath).toBe(repo);
      expect(state.status.branch).toBe(task.branchName);
      expect(state.status.isDirty).toBe(true);
      expect(state.status.activeTask.title).toBe('Review local audit');
      expect(state.diffStat).toContain('README.md');
      expect(state.latestSnapshot.path).toBe(snapshot.path);
      expect(state.latestSnapshot.content).toContain('dashboard ok');
      expect(state.commands.codexPrompt).toBe('wcb codex prompt --verify "npm test -- --run"');
      expect(state.commands.snapshot).toBe('wcb snapshot --verify "npm test -- --run"');
      expect(state.commands.githubPackage).toBe('wcb github package --base main');
      expect(state.commands.githubPublish).toBe('wcb github publish --base main');
      expect(state.githubPublishing.remoteUrl).toBe(null);
      expect(state.githubPublishing.baseBranch).toBe('main');
      expect(state.githubPublishing.headBranch).toBe(task.branchName);
      expect(state.githubPublishing.prUrl).toBe(null);
      expect(state.githubPublishing.guidance).toContain('先在 GitHub 创建仓库');
    } finally {
      await server.close();
    }
  });

  it('sets a GitHub remote and pushes base and task branches from the dashboard API', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    const remote = await mkdtemp(path.join(tmpdir(), 'wcb-remote-'));
    dirs.push(remote);
    execFileSync('git', ['init', '--bare'], { cwd: remote });
    await initBridge({ cwd: repo });
    const task = await createTask({
      cwd: repo,
      title: '网页发布到 GitHub',
      description: '从网页设置 remote 并推送分支。',
      checkout: true
    });
    await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nPublish from dashboard.\n');
    await createSnapshot({ cwd: repo, verifyCommand: 'node -e "console.log(\'publish ok\')"' });
    await commitTask({ cwd: repo });

    const server = await createDashboardServer({ cwd: repo, port: 0 });
    try {
      const remoteResponse = await postAction(server.url, 'github-set-remote', {
        remoteUrl: remote
      });
      expect(remoteResponse.ok).toBe(true);
      expect(remoteResponse.message).toBe('GitHub remote 已设置');
      expect(remoteResponse.state.githubPublishing.remoteUrl).toBe(remote);

      const pushResponse = await postAction(server.url, 'github-push-branches', {
        base: 'main'
      });
      expect(pushResponse.ok).toBe(true);
      expect(pushResponse.message).toBe('GitHub 分支已推送');
      expect(pushResponse.state.githubPublishing.headBranch).toBe(task.branchName);

      expect(execFileSync('git', ['rev-parse', 'main'], { cwd: remote, encoding: 'utf8' }).trim()).toBeTruthy();
      expect(execFileSync('git', ['rev-parse', task.branchName], { cwd: remote, encoding: 'utf8' }).trim()).toBeTruthy();
    } finally {
      await server.close();
    }
  });

  it('builds a browser PR link for GitHub remotes', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    const task = await createTask({
      cwd: repo,
      title: '网页 PR 链接',
      description: '让用户从浏览器打开 GitHub PR 创建页。',
      checkout: true
    });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/lanmod/PDF_OCR.git'], { cwd: repo });

    const server = await createDashboardServer({ cwd: repo, port: 0 });
    try {
      const state = await readState(server.url);

      expect(state.githubPublishing.remoteUrl).toBe('https://github.com/lanmod/PDF_OCR.git');
      expect(state.githubPublishing.prUrl).toBe(`https://github.com/lanmod/PDF_OCR/compare/main...${encodeURIComponent(task.branchName)}?expand=1`);
      expect(state.githubPublishing.guidance).toContain('如果浏览器没有登录 GitHub');
    } finally {
      await server.close();
    }
  });

  it('runs task handoff actions from the dashboard API', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });

    const server = await createDashboardServer({ cwd: repo, port: 0 });
    try {
      const taskResponse = await postAction(server.url, 'create-task', {
        title: '网页操作任务',
        description: '从浏览器驾驶舱创建任务。',
        checkout: true
      });
      expect(taskResponse.ok).toBe(true);
      expect(taskResponse.message).toBe('任务已创建');
      expect(taskResponse.state.status.activeTask.title).toBe('网页操作任务');

      const promptResponse = await postAction(server.url, 'codex-prompt', {
        verifyCommand: 'npm test -- --run'
      });
      expect(promptResponse.ok).toBe(true);
      expect(promptResponse.message).toBe('执行提示已生成');
      expect(promptResponse.state.handoffs.codex.content).toContain('网页操作任务');

      await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nWeb action change.\n');
      const snapshotResponse = await postAction(server.url, 'snapshot', {
        verifyCommand: 'node -e "console.log(\'web action ok\')"'
      });
      expect(snapshotResponse.ok).toBe(true);
      expect(snapshotResponse.message).toBe('Snapshot 已生成');
      expect(snapshotResponse.state.latestSnapshot.content).toContain('web action ok');
    } finally {
      await server.close();
    }
  });

  it('creates the first task from the dashboard API before manual init', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);

    const server = await createDashboardServer({ cwd: repo, port: 0 });
    try {
      const response = await postAction(server.url, 'create-task', {
        title: '网页首个任务',
        description: '没有 config.json 时也能从网页创建。',
        checkout: true
      });

      expect(response.ok).toBe(true);
      expect(response.message).toBe('任务已创建');
      expect(response.state.status.activeTask.title).toBe('网页首个任务');
      expect(response.state.primaryAction).toEqual({
        action: 'codex-prompt',
        label: '生成执行提示',
        enabled: true
      });
    } finally {
      await server.close();
    }
  });

  it('serves cockpit state with pipeline and handoff content', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    await createTask({
      cwd: repo,
      title: 'Operate from cockpit',
      description: 'Make the dashboard guide reviewer AI, executor agent, and GitHub handoffs.',
      checkout: true
    });
    const prompt = await createCodexPrompt({ cwd: repo, verifyCommand: 'npm test -- --run' });
    await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nCockpit change.\n');
    const snapshot = await createSnapshot({ cwd: repo, verifyCommand: 'node -e "console.log(\'cockpit ok\')"' });
    await commitTask({ cwd: repo });
    const githubPackage = await createGithubPackage({ cwd: repo, base: 'main' });

    const server = await createDashboardServer({ cwd: repo, port: 0 });
    try {
      const response = await fetch(`${server.url}/api/state`);
      const state = await response.json();

      expect(state.stage.id).toBe('github-ready');
      expect(state.stage.label).toBe('可交给 GitHub / 评审 AI');
      expect(state.stage.nextAction).toBe('复制 GitHub 交接包，或在 GitHub 环境可用后发布 PR。');
      expect(state.stage.nextLocation).toBe('网页操作台 / GitHub');
      expect(state.primaryAction).toEqual({
        action: 'github-package',
        label: '更新 GitHub 交接包',
        enabled: true
      });
      expect(state.workspace).toEqual({
        hasCodeChanges: false,
        label: '仅交接包未提交'
      });
      expect(state.pipeline.map((step: { id: string; state: string }) => [step.id, step.state])).toEqual([
        ['task', 'done'],
        ['codex-prompt', 'done'],
        ['codex-work', 'done'],
        ['snapshot', 'done'],
        ['commit', 'done'],
        ['github', 'ready']
      ]);
      expect(state.handoffs.codex.path).toBe(prompt.path);
      expect(state.handoffs.codex.content).toContain('Operate from cockpit');
      expect(state.handoffs.executor.label).toBe('给执行 Agent');
      expect(state.handoffs.executor.content).toContain('Operate from cockpit');
      expect(state.handoffs.chatgpt.content).toContain('cockpit ok');
      expect(state.handoffs.reviewer.label).toBe('给评审 AI');
      expect(state.handoffs.reviewer.content).toContain('cockpit ok');
      expect(state.handoffs.github.path).toBe(githubPackage.path);
      expect(state.handoffs.github.label).toBe('给 GitHub');
      expect(state.handoffs.github.content).toContain('GitHub PR 交接包');
      expect(state.environment.readyForGithub).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('serves the next primary action for each cockpit stage', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });

    const server = await createDashboardServer({ cwd: repo, port: 0 });
    try {
      const initial = await readState(server.url);
      expect(initial.primaryAction).toEqual({
        action: 'create-task',
        label: '创建任务',
        enabled: true
      });
      expect(initial.stage.nextLocation).toBe('网页操作台');

      await postAction(server.url, 'create-task', {
        title: '阶段主按钮',
        description: '让页面只突出当前最重要动作。',
        checkout: true
      });
      const taskCreated = await readState(server.url);
      expect(taskCreated.primaryAction).toEqual({
        action: 'codex-prompt',
        label: '生成执行提示',
        enabled: true
      });
      expect(taskCreated.stage.nextLocation).toBe('网页操作台');

      await postAction(server.url, 'codex-prompt', {
        verifyCommand: 'npm test -- --run'
      });
      const promptCreated = await readState(server.url);
      expect(promptCreated.primaryAction).toEqual({
        action: 'copy-executor',
        label: '复制给执行 Agent',
        enabled: true
      });
      expect(promptCreated.stage.nextLocation).toBe('执行 Agent');

      await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nPrimary action change.\n');
      const dirty = await readState(server.url);
      expect(dirty.primaryAction).toEqual({
        action: 'snapshot',
        label: '生成 snapshot',
        enabled: true
      });
      expect(dirty.stage.nextLocation).toBe('网页操作台');

      await postAction(server.url, 'snapshot', {
        verifyCommand: 'node -e "console.log(\'primary action ok\')"'
      });
      const snapshotted = await readState(server.url);
      expect(snapshotted.primaryAction).toEqual({
        action: 'copy-reviewer',
        label: '复制给评审 AI',
        enabled: true
      });
      expect(snapshotted.stage.nextLocation).toBe('评审 AI');
    } finally {
      await server.close();
    }
  });

  it('serves a cockpit page with pipeline and handoff tabs', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });

    const server = await createDashboardServer({ cwd: repo, port: 0 });
    try {
      const response = await fetch(`${server.url}/`);
      const html = await response.text();

      expect(html).toContain('任务驾驶舱');
      expect(html).toContain('任务流水线');
      expect(html).toContain('给执行 Agent');
      expect(html).toContain('给评审 AI');
      expect(html).toContain('给 GitHub');
      expect(html).toContain('网页操作台');
      expect(html).toContain('阶段主按钮');
      expect(html).toContain('更多操作');
      expect(html).toContain('GitHub 发布');
      expect(html).toContain('下一步位置');
      expect(html).toContain('id="copyState"');
      expect(html).toContain('id="projectPath"');
      expect(html).toContain('name="title"');
      expect(html).toContain('name="description"');
      expect(html).toContain('name="verifyCommand"');
      expect(html).toContain('name="remoteUrl"');
      expect(html).toContain('id="githubPrLink"');
      expect(html).toContain('data-action="create-task"');
      expect(html).toContain('data-action="codex-prompt"');
      expect(html).toContain('data-action="snapshot"');
      expect(html).toContain('data-action="commit"');
      expect(html).toContain('data-action="rollback"');
      expect(html).toContain('data-action="github-package"');
      expect(html).toContain('data-action="github-set-remote"');
      expect(html).toContain('data-action="github-push-branches"');
    } finally {
      await server.close();
    }
  });

  it('enforces token authentication when a token is configured', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    await createTask({ cwd: repo, title: 'Token task', description: 'Token required.' });

    const token = 'test-token-1234';
    const server = await createDashboardServer({ cwd: repo, port: 0, token });
    try {
      // 1. Request page without token -> should fail with 403
      const resPageNoToken = await fetch(`${server.url}/`);
      expect(resPageNoToken.status).toBe(403);

      // 2. Request page with token -> should succeed
      const resPageWithToken = await fetch(`${server.url}/?token=${token}`);
      expect(resPageWithToken.status).toBe(200);

      // 3. Request API state without token -> should fail
      const resStateNoToken = await fetch(`${server.url}/api/state`);
      expect(resStateNoToken.status).toBe(403);

      // 4. Request API state with query token -> should succeed
      const resStateQueryToken = await fetch(`${server.url}/api/state?token=${token}`);
      expect(resStateQueryToken.status).toBe(200);

      // 5. Request API state with header token -> should succeed
      const resStateHeaderToken = await fetch(`${server.url}/api/state`, {
        headers: { 'X-WCB-Token': token }
      });
      expect(resStateHeaderToken.status).toBe(200);

      // 6. Post action without token -> should fail
      const resActionNoToken = await fetch(`${server.url}/api/actions/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' }
      });
      expect(resActionNoToken.status).toBe(403);

      // 7. Post action with token -> should bypass token check but fail with 500 due to unknown action
      const resActionWithToken = await fetch(`${server.url}/api/actions/refresh`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-WCB-Token': token
        }
      });
      expect(resActionWithToken.status).toBe(500);
      const actionResult = await resActionWithToken.json();
      expect(actionResult.error).toContain('未知操作');
    } finally {
      await server.close();
    }
  });
});

async function postAction(serverUrl: string, action: string, body: Record<string, unknown>) {
  const response = await fetch(`${serverUrl}/api/actions/${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function readState(serverUrl: string) {
  const response = await fetch(`${serverUrl}/api/state`);
  return response.json();
}
