import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitTask, createSnapshot, createTask, initBridge, rollbackTask } from '../src/commands.js';
import { createTempGitRepo, removeTempDir } from './helpers.js';

const dirs: string[] = [];

describe('audit safety', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(removeTempDir));
  });

  it('includes staged code changes in snapshot diff', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    await createTask({ cwd: repo, title: 'staged diff', description: 'capture staged changes', checkout: true });

    await writeFile(path.join(repo, 'feature.txt'), 'hello staged diff\n', 'utf8');
    execFileSync('git', ['add', 'feature.txt'], { cwd: repo });

    const snapshot = await createSnapshot({ cwd: repo });
    const content = await readFile(snapshot.path, 'utf8');

    expect(content).toContain('Diff Hash:');
    expect(content).toContain('feature.txt');
    expect(content).toContain('hello staged diff');
  });

  it('rejects creating a task when non-bridge code changes are dirty by default', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    await writeFile(path.join(repo, 'dirty.txt'), 'dirty\n', 'utf8');

    await expect(createTask({ cwd: repo, title: 'dirty', description: 'dirty task' }))
      .rejects
      .toThrow('创建任务前需要先提交');
  });

  it('rejects task actions when current branch does not match the active task branch', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    await createTask({ cwd: repo, title: 'branch guard', description: 'guard branch', checkout: true });
    execFileSync('git', ['switch', 'main'], { cwd: repo });

    await expect(createSnapshot({ cwd: repo })).rejects.toThrow('active task 要求在');
    await expect(rollbackTask({ cwd: repo, force: true })).rejects.toThrow('active task 要求在');
  });

  it('rejects commit when code changed after latest snapshot', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    await createTask({ cwd: repo, title: 'fresh snapshot', description: 'require fresh snapshot', checkout: true });

    const file = path.join(repo, 'fresh.txt');
    await writeFile(file, 'first version\n', 'utf8');
    await createSnapshot({ cwd: repo });
    await writeFile(file, 'second version\n', 'utf8');

    await expect(commitTask({ cwd: repo })).rejects.toThrow('重新生成 snapshot');
  });
});
