import { afterEach, describe, expect, it } from 'vitest';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { commitTask, createSnapshot, createTask, getBridgeStatus, initBridge, rollbackTask } from '../src/commands.js';
import { runGit } from '../src/git.js';
import { createTempGitRepo, removeTempDir } from './helpers.js';

const dirs: string[] = [];

describe('commitTask and rollbackTask', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(removeTempDir));
  });

  it('refuses to commit when there are no changes', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    await createTask({
      cwd: repo,
      title: 'No-op task',
      description: 'There is nothing to commit.',
      checkout: true
    });
    await runGit(repo, ['add', '.webcodexbridge']);
    await runGit(repo, ['commit', '-m', 'record task metadata']);

    await expect(commitTask({ cwd: repo })).rejects.toThrow('No changes to commit.');
  });

  it('stages changes, creates a commit, and updates task status', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    const task = await createTask({
      cwd: repo,
      title: 'Commit local task',
      description: 'Commit task output.',
      checkout: true
    });
    await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nCommitted change.\n');

    const result = await commitTask({ cwd: repo });

    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await runGit(repo, ['log', '-1', '--pretty=%s'])).toBe('任务提交：Commit local task');
    expect(await runGit(repo, ['status', '--short'])).toBe('');

    const stored = JSON.parse(
      await readFile(path.join(repo, '.webcodexbridge', 'tasks', task.id, 'task.json'), 'utf8')
    );
    expect(stored.status).toBe('committed');
  });

  it('refuses rollback with uncommitted changes unless force is true', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    await createTask({
      cwd: repo,
      title: 'Guard rollback',
      description: 'Protect local edits.',
      checkout: true
    });
    await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nUncommitted change.\n');

    await expect(rollbackTask({ cwd: repo })).rejects.toThrow('Rollback refused because the working tree has uncommitted changes.');
  });

  it('forced rollback resets to the task base commit and records rolled_back status', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    const task = await createTask({
      cwd: repo,
      title: 'Rollback task',
      description: 'Return to base commit.',
      checkout: true
    });
    await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nChange to remove.\n');
    await commitTask({ cwd: repo });

    const result = await rollbackTask({ cwd: repo, force: true });

    expect(result.baseCommit).toBe(task.baseCommit);
    expect(await runGit(repo, ['rev-parse', 'HEAD'])).toBe(task.baseCommit);
    expect(await readFile(path.join(repo, 'README.md'), 'utf8')).toBe('# Test Repo\n');

    const stored = JSON.parse(
      await readFile(path.join(repo, '.webcodexbridge', 'tasks', task.id, 'task.json'), 'utf8')
    );
    expect(stored.status).toBe('rolled_back');
  });

  it('forced rollback preserves bridge config and snapshot audit records', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    const task = await createTask({
      cwd: repo,
      title: 'Preserve audit trail',
      description: 'Keep snapshot evidence after rollback.',
      checkout: true
    });
    await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nSnapshot before rollback.\n');
    const snapshot = await createSnapshot({ cwd: repo, verifyCommand: 'node -e "console.log(\'audit ok\')"' });
    await commitTask({ cwd: repo });

    await rollbackTask({ cwd: repo, force: true });

    expect((await stat(path.join(repo, '.webcodexbridge', 'config.json'))).isFile()).toBe(true);
    expect((await stat(snapshot.path)).isFile()).toBe(true);

    const status = await getBridgeStatus({ cwd: repo });
    expect(status.latestSnapshotPath).toBe(snapshot.path);
    expect(await readFile(snapshot.path, 'utf8')).toContain('audit ok');

    const stored = JSON.parse(
      await readFile(path.join(repo, '.webcodexbridge', 'tasks', task.id, 'task.json'), 'utf8')
    );
    expect(stored.status).toBe('rolled_back');
  });
});
