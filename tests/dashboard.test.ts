import { afterEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
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
      description: 'Make the dashboard guide ChatGPT, Codex, and GitHub handoffs.',
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
      expect(state.stage.label).toBe('可交给 GitHub / ChatGPT');
      expect(state.stage.nextAction).toBe('复制 GitHub 交接包，或在 GitHub 环境可用后发布 PR。');
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
      expect(state.handoffs.chatgpt.content).toContain('cockpit ok');
      expect(state.handoffs.github.path).toBe(githubPackage.path);
      expect(state.handoffs.github.content).toContain('GitHub PR 交接包');
      expect(state.environment.readyForGithub).toBe(false);
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
      expect(html).toContain('给 Codex');
      expect(html).toContain('给 ChatGPT');
      expect(html).toContain('给 GitHub');
    } finally {
      await server.close();
    }
  });
});
