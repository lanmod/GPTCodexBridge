import { afterEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  commitTask,
  createGithubPackage,
  createSnapshot,
  createTask,
  initBridge,
  publishTaskToGithub
} from '../src/commands.js';
import { createTempGitRepo, removeTempDir } from './helpers.js';
import type { ToolRunner } from '../src/types.js';

const dirs: string[] = [];

describe('publishTaskToGithub', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(removeTempDir));
  });

  it('pushes the task branch and creates a GitHub PR from the latest snapshot', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    const task = await createTask({
      cwd: repo,
      title: '发布到 GitHub',
      description: '把本地任务发布成 PR。',
      checkout: true
    });
    await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nPublish change.\n');
    const snapshot = await createSnapshot({ cwd: repo, verifyCommand: 'node -e "console.log(\'ok\')"' });
    await commitTask({ cwd: repo });

    const calls: Array<{ tool: string; args: string[]; cwd: string }> = [];
    const runner: ToolRunner = async (tool, args, options) => {
      calls.push({ tool, args, cwd: options.cwd });
      if (tool === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        return 'https://github.com/example/repo/pull/7';
      }
      return '';
    };

    const result = await publishTaskToGithub({
      cwd: repo,
      base: 'main',
      runner
    });

    expect(result).toEqual({
      taskId: task.id,
      branchName: task.branchName,
      snapshotPath: snapshot.path,
      prUrl: 'https://github.com/example/repo/pull/7'
    });
    expect(calls).toEqual([
      {
        tool: 'git',
        args: ['push', '-u', 'origin', task.branchName],
        cwd: repo
      },
      {
        tool: 'gh',
        args: [
          'pr',
          'create',
          '--base',
          'main',
          '--head',
          task.branchName,
          '--title',
          '发布到 GitHub',
          '--body-file',
          snapshot.path
        ],
        cwd: repo
      }
    ]);
  });

  it('refuses to publish when no snapshot exists', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    await createTask({
      cwd: repo,
      title: '缺少 snapshot',
      description: '发布前必须有结果包。',
      checkout: true
    });
    await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nNo snapshot.\n');
    await commitTask({ cwd: repo });

    await expect(
      publishTaskToGithub({
        cwd: repo,
        runner: async () => ''
      })
    ).rejects.toThrow('发布到 GitHub 前需要先生成 snapshot。');
  });

  it('refuses to publish when the working tree has uncommitted changes', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    await createTask({
      cwd: repo,
      title: '工作区未清理',
      description: '发布前要保持干净。',
      checkout: true
    });
    await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nDirty change.\n');
    await createSnapshot({ cwd: repo });

    await expect(
      publishTaskToGithub({
        cwd: repo,
        runner: async () => ''
      })
    ).rejects.toThrow('发布到 GitHub 前需要先提交或清理本地改动。');
  });

  it('allows publishing when the only dirty file is the generated GitHub package', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    const task = await createTask({
      cwd: repo,
      title: '允许交接包后发布',
      description: '生成交接包不应阻断 PR 发布。',
      checkout: true
    });
    await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nPublish after package.\n');
    const snapshot = await createSnapshot({ cwd: repo });
    await commitTask({ cwd: repo });
    await createGithubPackage({ cwd: repo, base: 'main' });

    const calls: Array<{ tool: string; args: string[]; cwd: string }> = [];
    const runner: ToolRunner = async (tool, args, options) => {
      calls.push({ tool, args, cwd: options.cwd });
      if (tool === 'gh') {
        return 'https://github.com/example/repo/pull/8';
      }
      return '';
    };

    const result = await publishTaskToGithub({ cwd: repo, runner });

    expect(result.prUrl).toBe('https://github.com/example/repo/pull/8');
    expect(calls[0]).toEqual({
      tool: 'git',
      args: ['push', '-u', 'origin', task.branchName],
      cwd: repo
    });
    expect(calls[1].args).toContain(snapshot.path);
  });
});
