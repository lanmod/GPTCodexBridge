import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

  it('rejects task actions when executed directly inside the WCB tool repository', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);
    await initBridge({ cwd: repo });

    // Mock package.json designating this as the tool repository
    await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'webcodexbridge', bin: { wcb: './dist/cli.js' } }), 'utf8');
    execFileSync('git', ['add', 'package.json'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'add package.json'], { cwd: repo });

    // Attempting to create a task should throw
    await expect(createTask({ cwd: repo, title: 'self test', description: 'self test' }))
      .rejects
      .toThrow('当前目录或所在的 Git 仓库根目录为 WebCodexBridge 工具源码仓库本身');

    // Using internalDogfood bypass should succeed
    const task = await createTask({
      cwd: repo,
      title: 'dogfood test',
      description: 'dogfood test',
      internalDogfood: true,
      checkout: true
    });
    expect(task.title).toBe('dogfood test');
  });

  it('rejects task actions when executed in a subdirectory of the WCB tool repository', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);

    // Mock package.json designating this as the tool repository at the Git root
    await writeFile(
      path.join(repo, 'package.json'),
      JSON.stringify({
        name: 'webcodexbridge',
        bin: { wcb: './dist/cli.js' }
      }),
      'utf8'
    );
    execFileSync('git', ['add', 'package.json'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'add package.json'], { cwd: repo });

    await initBridge({ cwd: repo, internalDogfood: true });

    // Create a subdirectory under git root
    const subdir = path.join(repo, 'my-sub-project');
    await mkdir(subdir);

    // Attempting to create a task inside the subdirectory should throw because the Git root is identified as the tool repository
    await expect(createTask({ cwd: subdir, title: 'sub test', description: 'sub test' }))
      .rejects
      .toThrow('当前目录或所在的 Git 仓库根目录为 WebCodexBridge 工具源码仓库本身');

    // Using internalDogfood bypass should succeed
    const task = await createTask({
      cwd: subdir,
      title: 'sub dogfood test',
      description: 'sub dogfood test',
      internalDogfood: true,
      checkout: true
    });
    expect(task.title).toBe('sub dogfood test');
  });

  it('throws an error when CLI is invoked with --project but no path is specified', async () => {
    const cliPath = path.resolve(process.cwd(), 'dist/cli.js');
    try {
      execFileSync('node', [cliPath, 'init', '--project'], { stdio: 'pipe' });
      expect.fail('CLI should have failed with missing project path');
    } catch (error: any) {
      expect(error.status).toBe(1);
      expect(error.stderr.toString()).toContain('--project 需要指定目标项目目录');
    }
  });
});

