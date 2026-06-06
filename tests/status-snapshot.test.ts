import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createSnapshot, createTask, getBridgeStatus, initBridge } from '../src/commands.js';
import { createTempGitRepo, removeTempDir } from './helpers.js';

const dirs: string[] = [];

describe('status and snapshot', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(removeTempDir));
  });

  it('reports current branch, dirty state, and active task', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    const task = await createTask({
      cwd: repo,
      title: 'Track local state',
      description: 'Show task and Git state.',
      checkout: true
    });
    await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nChanged.\n');

    const status = await getBridgeStatus({ cwd: repo });

    expect(status.branch).toBe(task.branchName);
    expect(status.isDirty).toBe(true);
    expect(status.activeTask?.id).toBe(task.id);
    expect(status.latestSnapshotPath).toBeNull();
  });

  it('writes a markdown result package with git evidence and verification output', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    const task = await createTask({
      cwd: repo,
      title: 'Generate local snapshot',
      description: 'Record diff and verification.',
      checkout: true
    });
    await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nSnapshot change.\n');

    const snapshot = await createSnapshot({
      cwd: repo,
      verifyCommand: 'node -e "console.log(\'verify ok\')"'
    });

    const markdown = await readFile(snapshot.path, 'utf8');
    expect(snapshot.taskId).toBe(task.id);
    expect(markdown).toContain('# WebCodexBridge Snapshot');
    expect(markdown).toContain('Generate local snapshot');
    expect(markdown).toContain('## Git Status');
    expect(markdown).toContain(' M README.md');
    expect(markdown).toContain('## Git Diff Stat');
    expect(markdown).toContain('README.md');
    expect(markdown).toContain('## Git Diff');
    expect(markdown).toContain('+Snapshot change.');
    expect(markdown).toContain('## Verification');
    expect(markdown).toContain('Command: `node -e "console.log(\'verify ok\')"`');
    expect(markdown).toContain('Exit Code: `0`');
    expect(markdown).toContain('verify ok');
  });
});
