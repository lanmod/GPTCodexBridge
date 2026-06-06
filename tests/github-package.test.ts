import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  commitTask,
  createGithubPackage,
  createSnapshot,
  createTask,
  initBridge
} from '../src/commands.js';
import { createTempGitRepo, removeTempDir } from './helpers.js';

const dirs: string[] = [];

describe('createGithubPackage', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(removeTempDir));
  });

  it('writes a reusable GitHub PR handoff package from the latest snapshot', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    const task = await createTask({
      cwd: repo,
      title: '生成 GitHub 交接包',
      description: '让 ChatGPT 能读取 PR 和 snapshot。',
      checkout: true
    });
    await writeFile(path.join(repo, 'README.md'), '# Test Repo\n\nPackage change.\n');
    const snapshot = await createSnapshot({ cwd: repo, verifyCommand: 'node -e "console.log(\'package ok\')"' });
    await commitTask({ cwd: repo });

    const result = await createGithubPackage({ cwd: repo, base: 'main' });

    expect(result).toEqual({
      taskId: task.id,
      path: path.join(repo, '.webcodexbridge', 'tasks', task.id, 'github-pr-package.md'),
      snapshotPath: snapshot.path,
      title: '生成 GitHub 交接包'
    });

    const markdown = await readFile(result.path, 'utf8');
    expect(markdown).toContain('# GitHub PR 交接包');
    expect(markdown).toContain('PR 标题：生成 GitHub 交接包');
    expect(markdown).toContain(`PR Body 文件：${snapshot.path}`);
    expect(markdown).toContain(`git push -u origin ${task.branchName}`);
    expect(markdown).toContain(`gh pr create --base main --head ${task.branchName} --title "生成 GitHub 交接包" --body-file "${snapshot.path}"`);
    expect(markdown).toContain('请读取这个 PR，帮我评审这次 Codex 修改是否合理');
  });

  it('refuses to create a package when no snapshot exists', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    await createTask({
      cwd: repo,
      title: '缺少交接包输入',
      description: '没有 snapshot 就不能交接。',
      checkout: true
    });

    await expect(createGithubPackage({ cwd: repo })).rejects.toThrow('生成 GitHub 交接包前需要先生成 snapshot。');
  });
});
