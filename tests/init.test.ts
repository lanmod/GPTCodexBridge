import { afterEach, describe, expect, it } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
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
});
