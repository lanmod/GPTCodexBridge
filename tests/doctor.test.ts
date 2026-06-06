import { afterEach, describe, expect, it } from 'vitest';
import { checkBridgeEnvironment } from '../src/commands.js';
import { createTempGitRepo, removeTempDir } from './helpers.js';
import type { ToolRunner } from '../src/types.js';

const dirs: string[] = [];

describe('checkBridgeEnvironment', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(removeTempDir));
  });

  it('reports missing GitHub CLI and missing origin remote', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    const runner: ToolRunner = async (tool, args) => {
      if (tool === 'git' && args[0] === '--version') {
        return 'git version 2.50.1';
      }
      if (tool === 'git' && args[0] === 'remote') {
        throw new Error('No such remote');
      }
      if (tool === 'gh') {
        throw new Error('command not found: gh');
      }
      return '';
    };

    const result = await checkBridgeEnvironment({ cwd: repo, runner });

    expect(result.readyForLocalGit).toBe(true);
    expect(result.readyForGithub).toBe(false);
    expect(result.checks).toEqual([
      { name: 'Git CLI', ok: true, detail: 'git version 2.50.1' },
      { name: 'Git 仓库', ok: true, detail: '当前目录是 Git 仓库' },
      { name: 'GitHub CLI', ok: false, detail: '未检测到 gh，请先安装并登录 GitHub CLI' },
      { name: 'origin remote', ok: false, detail: '未配置 origin remote，无法 push 任务分支' }
    ]);
  });

  it('reports GitHub readiness when gh and origin are available', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    const runner: ToolRunner = async (tool, args) => {
      if (tool === 'git' && args[0] === '--version') {
        return 'git version 2.50.1';
      }
      if (tool === 'git' && args[0] === 'remote') {
        return 'git@github.com:example/repo.git';
      }
      if (tool === 'gh') {
        return 'gh version 2.74.0';
      }
      return '';
    };

    const result = await checkBridgeEnvironment({ cwd: repo, runner });

    expect(result.readyForLocalGit).toBe(true);
    expect(result.readyForGithub).toBe(true);
    expect(result.checks.at(-1)).toEqual({
      name: 'origin remote',
      ok: true,
      detail: 'git@github.com:example/repo.git'
    });
  });
});
