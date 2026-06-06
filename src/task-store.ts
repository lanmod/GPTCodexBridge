import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BridgeConfig, BridgeTask } from './types.js';

export const bridgeDirName = '.webcodexbridge';

export const defaultConfig: BridgeConfig = {
  version: 1,
  branchPrefix: 'wb',
  tasksDir: '.webcodexbridge/tasks'
};

export async function writeDefaultConfig(cwd: string): Promise<{ configPath: string; tasksPath: string }> {
  const bridgeDir = path.join(cwd, bridgeDirName);
  const tasksPath = path.join(cwd, defaultConfig.tasksDir);
  const configPath = path.join(bridgeDir, 'config.json');

  await mkdir(tasksPath, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, 'utf8');

  return { configPath, tasksPath };
}

export async function readConfig(cwd: string): Promise<BridgeConfig> {
  const configPath = path.join(cwd, bridgeDirName, 'config.json');
  return JSON.parse(await readFile(configPath, 'utf8')) as BridgeConfig;
}

export function taskDirectory(cwd: string, taskId: string): string {
  return path.join(cwd, defaultConfig.tasksDir, taskId);
}

export async function writeTask(cwd: string, task: BridgeTask): Promise<void> {
  const dir = taskDirectory(cwd, task.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  await writeFile(path.join(cwd, bridgeDirName, 'active-task.json'), `${JSON.stringify({ id: task.id }, null, 2)}\n`, 'utf8');
}

export async function updateTask(cwd: string, task: BridgeTask): Promise<BridgeTask> {
  const updated = {
    ...task,
    updatedAt: new Date().toISOString()
  };
  await writeTask(cwd, updated);
  return updated;
}

export async function readTask(cwd: string, taskId: string): Promise<BridgeTask> {
  return JSON.parse(await readFile(path.join(taskDirectory(cwd, taskId), 'task.json'), 'utf8')) as BridgeTask;
}

export async function readActiveTask(cwd: string): Promise<BridgeTask | null> {
  try {
    const activePath = path.join(cwd, bridgeDirName, 'active-task.json');
    const active = JSON.parse(await readFile(activePath, 'utf8')) as { id: string };
    return readTask(cwd, active.id);
  } catch {
    return null;
  }
}

export async function writeSnapshot(cwd: string, taskId: string, markdown: string): Promise<string> {
  const snapshotsDir = path.join(taskDirectory(cwd, taskId), 'snapshots');
  await mkdir(snapshotsDir, { recursive: true });
  const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
  const snapshotPath = path.join(snapshotsDir, filename);
  await writeFile(snapshotPath, markdown, 'utf8');
  return snapshotPath;
}

export async function latestSnapshotPath(cwd: string, taskId: string): Promise<string | null> {
  const snapshotsDir = path.join(taskDirectory(cwd, taskId), 'snapshots');
  try {
    const files = (await readdir(snapshotsDir)).filter((file) => file.endsWith('.md')).sort();
    const latest = files.at(-1);
    return latest ? path.join(snapshotsDir, latest) : null;
  } catch {
    return null;
  }
}
