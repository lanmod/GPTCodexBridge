#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import {
  commitTask,
  createCodexPrompt,
  createGithubPackage,
  createSnapshot,
  createTask,
  checkBridgeEnvironment,
  getBridgeStatus,
  initBridge,
  publishTaskToGithub,
  rollbackTask
} from './commands.js';
import { createDashboardServer } from './dashboard.js';

async function main(): Promise<void> {
  const projectIndex = process.argv.indexOf('--project');
  let cwd = process.cwd();
  if (projectIndex !== -1) {
    const value = process.argv[projectIndex + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('--project 需要指定目标项目目录');
    }
    cwd = path.resolve(process.cwd(), value);
    process.argv.splice(projectIndex, 2);
  }

  const dogfoodIndex = process.argv.indexOf('--internal-dogfood');
  const internalDogfood = dogfoodIndex !== -1;
  if (internalDogfood) {
    process.argv.splice(dogfoodIndex, 1);
  }

  const [command] = process.argv.slice(2);

  if (command === 'init') {
    const result = await initBridge({
      cwd,
      internalDogfood,
      allowSubdirProject: process.argv.includes('--allow-subdir-project')
    });
    console.log(`Initialized WebCodexBridge at ${result.configPath}`);
    return;
  }

  if (command === 'doctor') {
    const diagnostics = await checkBridgeEnvironment({ cwd });
    for (const check of diagnostics.checks) {
      console.log(`${check.ok ? 'OK' : '缺失'} ${check.name}: ${check.detail}`);
    }
    console.log(`本地 Git 闭环: ${diagnostics.readyForLocalGit ? '可用' : '不可用'}`);
    console.log(`GitHub 共享状态层: ${diagnostics.readyForGithub ? '可用' : '不可用'}`);
    return;
  }

  if (command === 'task' && process.argv[3] === 'create') {
    const task = await createTask({
      cwd,
      title: readFlag('--title'),
      description: readFlag('--description'),
      checkout: process.argv.includes('--checkout'),
      allowDirty: process.argv.includes('--allow-dirty'),
      internalDogfood
    });
    console.log(`Created task ${task.id}`);
    console.log(`Branch: ${task.branchName}`);
    return;
  }

  if (command === 'codex' && process.argv[3] === 'prompt') {
    const result = await createCodexPrompt({
      cwd,
      verifyCommand: optionalFlag('--verify'),
      internalDogfood
    });
    console.log(`Codex 执行提示: ${result.path}`);
    return;
  }

  if (command === 'status') {
    const status = await getBridgeStatus({ cwd });
    console.log(`Branch: ${status.branch}`);
    console.log(`Dirty: ${status.isDirty ? 'yes' : 'no'}`);
    console.log(`Active task: ${status.activeTask ? status.activeTask.id : 'none'}`);
    console.log(`Latest snapshot: ${status.latestSnapshotPath ?? 'none'}`);
    return;
  }

  if (command === 'snapshot') {
    const snapshot = await createSnapshot({
      cwd,
      verifyCommand: optionalFlag('--verify'),
      internalDogfood
    });
    console.log(`Snapshot written: ${snapshot.path}`);
    return;
  }

  if (command === 'commit') {
    const result = await commitTask({ cwd, internalDogfood });
    console.log(`Committed ${result.commit}`);
    console.log(result.message);
    return;
  }

  if (command === 'rollback') {
    const result = await rollbackTask({
      cwd,
      force: process.argv.includes('--force'),
      internalDogfood
    });
    console.log(`Rolled back task ${result.taskId} to ${result.baseCommit}`);
    return;
  }

  if (command === 'serve') {
    const token = randomBytes(16).toString('hex');
    const server = await createDashboardServer({
      cwd,
      port: Number(optionalFlag('--port') ?? '8787'),
      token,
      internalDogfood
    });
    console.log(`WebCodexBridge 本地控制台: ${server.url}/?token=${token}`);
    console.log('按 Ctrl+C 停止服务。');
    return;
  }

  if (command === 'github' && process.argv[3] === 'publish') {
    const result = await publishTaskToGithub({
      cwd,
      base: optionalFlag('--base'),
      internalDogfood
    });
    console.log(`GitHub PR: ${result.prUrl}`);
    return;
  }

  if (command === 'github' && process.argv[3] === 'package') {
    const result = await createGithubPackage({
      cwd,
      base: optionalFlag('--base'),
      internalDogfood
    });
    console.log(`GitHub 交接包: ${result.path}`);
    return;
  }

  console.error(`Usage: wcb [global options] <command> [options]

Global Options:
  --project <path>          指定被管理的目标项目目录
  --internal-dogfood        允许在 WebCodexBridge 工具仓库内开发工具自身

Commands:
  doctor
  init [--allow-subdir-project]
  task create --title "..." --description "..." [--checkout] [--allow-dirty]
  codex prompt [--verify "..."]
  status
  snapshot [--verify "..."]
  commit
  rollback [--force]
  serve [--port 8787]
  github package [--base <branch>]
  github publish [--base <branch>]

Examples:
  wcb --project ~/AIWorkspaces/my-project init
  wcb --project ~/AIWorkspaces/my-project serve
  wcb --internal-dogfood task create --title "test" --description "test"`);
  process.exitCode = 1;
}

function readFlag(name: string): string {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing required flag ${name}`);
  }
  return process.argv[index + 1];
}

function optionalFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
