import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { initBridge } from '../src/commands.js';
import { createTempGitRepo, removeTempDir } from './helpers.js';

const dirs: string[] = [];

describe('initBridge', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(removeTempDir));
  });

  it('creates config and task storage in a git repository', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);

    const result = await initBridge({ cwd: repo });

    expect(result.configPath).toBe(path.join(repo, '.webcodexbridge', 'config.json'));
    expect(await stat(path.join(repo, '.webcodexbridge', 'tasks'))).toMatchObject({
      isDirectory: expect.any(Function)
    });

    const config = JSON.parse(
      await readFile(path.join(repo, '.webcodexbridge', 'config.json'), 'utf8')
    );
    expect(config).toEqual({
      version: 1,
      branchPrefix: 'wb',
      tasksDir: '.webcodexbridge/tasks'
    });
  });

  it('rejects initialization inside the WebCodexBridge tool repository by default', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);

    // Mock package.json designating this as the tool repository
    await writeFile(
      path.join(repo, 'package.json'),
      JSON.stringify({
        name: 'webcodexbridge',
        bin: { wcb: './dist/cli.js' }
      }),
      'utf8'
    );

    // Attempting to initialize should throw
    await expect(initBridge({ cwd: repo }))
      .rejects
      .toThrow('当前目录或所在的 Git 仓库根目录为 WebCodexBridge 工具源码仓库本身');

    // Using internalDogfood bypass should succeed
    const result = await initBridge({ cwd: repo, internalDogfood: true });
    expect(result.configPath).toBe(path.join(repo, '.webcodexbridge', 'config.json'));
  });

  it('rejects initialization inside a Git subdirectory by default, but allowSubdirProject bypasses it', async () => {
    const repo = await createTempGitRepo();
    dirs.push(repo);

    const subdir = path.join(repo, 'sub-folder');
    await mkdir(subdir);

    // Initializing in subdirectory should throw
    await expect(initBridge({ cwd: subdir }))
      .rejects
      .toThrow('当前目录不是 Git 仓库根目录');

    // Using allowSubdirProject bypass should succeed
    const result = await initBridge({ cwd: subdir, allowSubdirProject: true });
    expect(result.configPath).toBe(path.join(subdir, '.webcodexbridge', 'config.json'));
  });
});
