import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createCodexPrompt, createTask, initBridge } from '../src/commands.js';
import { createTempGitRepo, removeTempDir } from './helpers.js';

const dirs: string[] = [];

describe('createCodexPrompt', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(removeTempDir));
  });

  it('writes a reusable Codex execution prompt for the active task', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    const task = await createTask({
      cwd: repo,
      title: '实现本地执行闭环',
      description: '让 Codex 在任务分支上修改代码，并生成可审计结果。',
      checkout: true
    });

    const result = await createCodexPrompt({
      cwd: repo,
      verifyCommand: 'npm test -- --run'
    });

    expect(result).toEqual({
      taskId: task.id,
      path: path.join(repo, '.webcodexbridge', 'tasks', task.id, 'codex-prompt.md')
    });

    const markdown = await readFile(result.path, 'utf8');
    expect(markdown).toContain('# Codex 执行提示');
    expect(markdown).toContain('任务标题：实现本地执行闭环');
    expect(markdown).toContain('当前任务分支：wb/task-');
    expect(markdown).toContain(`Base Commit：${task.baseCommit}`);
    expect(markdown).toContain('让 Codex 在任务分支上修改代码，并生成可审计结果。');
    expect(markdown).toContain('npm test -- --run');
    expect(markdown).toContain('不要直接提交到 main');
    expect(markdown).toContain('完成后运行 `wcb snapshot --verify "npm test -- --run"`');
  });

  it('uses a default verification command when none is provided', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });
    await createTask({
      cwd: repo,
      title: '默认验证命令',
      description: '没有传 verify 时也要有执行提示。',
      checkout: true
    });

    const result = await createCodexPrompt({ cwd: repo });
    const markdown = await readFile(result.path, 'utf8');

    expect(markdown).toContain('npm test -- --run');
  });
});
