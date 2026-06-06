import { afterEach, describe, expect, it } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createTask, initBridge } from '../src/commands.js';
import { runGit } from '../src/git.js';
import { createTempGitRepo, removeTempDir } from './helpers.js';

const dirs: string[] = [];

describe('createTask', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(removeTempDir));
  });

  it('stores task metadata with git base information and branch suggestion', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });

    const task = await createTask({
      cwd: repo,
      title: 'Fix login error!',
      description: 'Repair the local login failure path.'
    });

    const taskPath = path.join(repo, '.webcodexbridge', 'tasks', task.id, 'task.json');
    expect((await stat(taskPath)).isFile()).toBe(true);

    const stored = JSON.parse(await readFile(taskPath, 'utf8'));
    expect(stored).toMatchObject({
      id: task.id,
      slug: 'fix-login-error',
      title: 'Fix login error!',
      description: 'Repair the local login failure path.',
      baseBranch: 'main',
      branchName: 'wb/fix-login-error',
      status: 'created'
    });
    expect(stored.baseCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(stored.createdAt).toEqual(stored.updatedAt);
  });

  it('auto-initializes bridge config when creating the first task', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);

    const task = await createTask({
      cwd: repo,
      title: '网页直接创建任务',
      description: '没有手动 init 时也应该能创建任务。',
      checkout: true
    });

    const configPath = path.join(repo, '.webcodexbridge', 'config.json');
    expect((await stat(configPath)).isFile()).toBe(true);
    expect(task.branchName).toMatch(/^wb\//);
    expect(await runGit(repo, ['branch', '--show-current'])).toBe(task.branchName);
  });

  it('creates and checks out the task branch when requested', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });

    const task = await createTask({
      cwd: repo,
      title: 'Add snapshot command',
      description: 'Create local result packages.',
      checkout: true
    });

    expect(task.branchName).toBe('wb/add-snapshot-command');
    expect(await runGit(repo, ['branch', '--show-current'])).toBe('wb/add-snapshot-command');
  });

  it('uses a timestamped fallback slug for non-latin task titles', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });

    const task = await createTask({
      cwd: repo,
      title: '浏览器控制台验证',
      description: '中文标题也要生成安全分支。',
      checkout: true
    });

    expect(task.slug).toMatch(/^task-[0-9]{6}$/);
    expect(task.branchName).toMatch(/^wb\/task-[0-9]{6}$/);
    expect(await runGit(repo, ['branch', '--show-current'])).toBe(task.branchName);
  });
});
