import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  commit,
  createAndCheckoutBranch,
  getCurrentBranch,
  getDiff,
  getDiffStat,
  getHeadCommit,
  getStatusShort,
  isGitRepository,
  resetHard,
  runShell,
  runTool,
  stageAll
} from './git.js';
import {
  bridgeDirName,
  latestSnapshotPath,
  readActiveTask,
  readConfig,
  updateTask,
  writeDefaultConfig,
  writeSnapshot,
  writeTask
} from './task-store.js';
import type {
  BridgeStatus,
  BridgeTask,
  CodexPromptOptions,
  CodexPromptResult,
  CommitResult,
  CommandContext,
  CreateTaskOptions,
  EnvironmentDiagnostics,
  EnvironmentDiagnosticsOptions,
  GithubPackageOptions,
  GithubPackageResult,
  GithubPublishOptions,
  GithubPublishResult,
  InitResult,
  RollbackOptions,
  RollbackResult,
  SnapshotOptions,
  SnapshotResult
} from './types.js';

export async function initBridge(context: CommandContext): Promise<InitResult> {
  if (!(await isGitRepository(context.cwd))) {
    throw new Error('WebCodexBridge must be initialized inside a Git repository.');
  }

  return writeDefaultConfig(context.cwd);
}

export async function createTask(options: CreateTaskOptions): Promise<BridgeTask> {
  if (!(await isGitRepository(options.cwd))) {
    throw new Error('Tasks must be created inside a Git repository.');
  }

  const config = await readConfig(options.cwd);
  const now = new Date().toISOString();
  const slug = slugify(options.title, now);
  const task: BridgeTask = {
    id: `${compactDate(now)}-${slug}`,
    slug,
    title: options.title,
    description: options.description,
    baseBranch: await getCurrentBranch(options.cwd),
    baseCommit: await getHeadCommit(options.cwd),
    branchName: `${config.branchPrefix}/${slug}`,
    status: 'created',
    createdAt: now,
    updatedAt: now
  };

  await writeTask(options.cwd, task);

  if (options.checkout) {
    await createAndCheckoutBranch(options.cwd, task.branchName);
  }

  return task;
}

export async function getBridgeStatus(context: CommandContext): Promise<BridgeStatus> {
  const activeTask = await readActiveTask(context.cwd);
  const statusShort = await getStatusShort(context.cwd);

  return {
    branch: await getCurrentBranch(context.cwd),
    isDirty: statusShort.length > 0,
    statusShort,
    activeTask,
    latestSnapshotPath: activeTask ? await latestSnapshotPath(context.cwd, activeTask.id) : null
  };
}

export async function createSnapshot(options: SnapshotOptions): Promise<SnapshotResult> {
  const task = await readActiveTask(options.cwd);
  if (!task) {
    throw new Error('No active WebCodexBridge task found.');
  }

  const verification = options.verifyCommand
    ? await runShell(options.cwd, options.verifyCommand)
    : null;

  const markdown = [
    '# WebCodexBridge Snapshot',
    '',
    `Task: ${task.title}`,
    `Task ID: ${task.id}`,
    `Branch: ${await getCurrentBranch(options.cwd)}`,
    `Base: ${task.baseBranch} @ ${task.baseCommit}`,
    '',
    '## Task Description',
    '',
    task.description,
    '',
    '## Git Status',
    '',
    fence((await getStatusShort(options.cwd)) || 'clean'),
    '',
    '## Git Diff Stat',
    '',
    fence((await getDiffStat(options.cwd)) || 'no diff'),
    '',
    '## Git Diff',
    '',
    fence((await getDiff(options.cwd)) || 'no diff'),
    '',
    '## Verification',
    '',
    verification
      ? [`Command: \`${options.verifyCommand}\``, `Exit Code: \`${verification.exitCode}\``, '', fence(verification.output || 'no output')].join('\n')
      : 'No verification command provided.',
    ''
  ].join('\n');

  return {
    taskId: task.id,
    path: await writeSnapshot(options.cwd, task.id, markdown)
  };
}

export async function commitTask(context: CommandContext): Promise<CommitResult> {
  const task = await requireActiveTask(context.cwd);
  const statusShort = await getStatusShort(context.cwd);
  if (!statusShort) {
    throw new Error('No changes to commit.');
  }

  const updatedTask = await updateTask(context.cwd, { ...task, status: 'committed' });
  const message = `任务提交：${updatedTask.title}`;
  await stageAll(context.cwd);
  const commitHash = await commit(context.cwd, message);

  return {
    taskId: updatedTask.id,
    commit: commitHash,
    message
  };
}

export async function rollbackTask(options: RollbackOptions): Promise<RollbackResult> {
  const task = await requireActiveTask(options.cwd);
  const statusShort = await getStatusShort(options.cwd);
  if (statusShort && !options.force) {
    throw new Error('Rollback refused because the working tree has uncommitted changes. Re-run with force only when you are ready to discard them.');
  }

  const metadataBackup = await backupBridgeMetadata(options.cwd);
  try {
    await resetHard(options.cwd, task.baseCommit);
    await restoreBridgeMetadata(options.cwd, metadataBackup);
    await updateTask(options.cwd, { ...task, status: 'rolled_back' });
  } finally {
    await rm(metadataBackup.tempDir, { recursive: true, force: true });
  }

  return {
    taskId: task.id,
    baseCommit: task.baseCommit
  };
}

export async function createCodexPrompt(options: CodexPromptOptions): Promise<CodexPromptResult> {
  const task = await requireActiveTask(options.cwd);
  const verifyCommand = options.verifyCommand ?? 'npm test -- --run';
  const promptPath = path.join(options.cwd, bridgeDirName, 'tasks', task.id, 'codex-prompt.md');
  const markdown = [
    '# Codex 执行提示',
    '',
    `任务 ID：${task.id}`,
    `任务标题：${task.title}`,
    `当前任务分支：${task.branchName}`,
    `Base Branch：${task.baseBranch}`,
    `Base Commit：${task.baseCommit}`,
    '',
    '## 任务说明',
    '',
    task.description,
    '',
    '## 执行边界',
    '',
    '- 请只围绕当前任务修改代码。',
    '- 不要直接提交到 main。',
    '- 不要推送远端分支。',
    '- 不要删除 `.webcodexbridge/` 下的任务记录。',
    '- 如果发现需求不清楚，先停下来说明问题。',
    '',
    '## 建议验证',
    '',
    fence(verifyCommand),
    '',
    '## 完成后',
    '',
    `完成后运行 \`wcb snapshot --verify "${verifyCommand}"\`，生成给 ChatGPT 和 GitHub PR 使用的结果包。`,
    ''
  ].join('\n');

  await writeFile(promptPath, markdown, 'utf8');

  return {
    taskId: task.id,
    path: promptPath
  };
}

export async function publishTaskToGithub(options: GithubPublishOptions): Promise<GithubPublishResult> {
  const task = await requireActiveTask(options.cwd);
  const statusShort = await getStatusShort(options.cwd);
  if (statusShort && !isOnlyGithubPackageDirty(statusShort, task.id)) {
    throw new Error('发布到 GitHub 前需要先提交或清理本地改动。');
  }

  const snapshotPath = await latestSnapshotPath(options.cwd, task.id);
  if (!snapshotPath) {
    throw new Error('发布到 GitHub 前需要先生成 snapshot。');
  }

  const runner = options.runner ?? runTool;
  const base = options.base ?? task.baseBranch;

  await runner('git', ['push', '-u', 'origin', task.branchName], { cwd: options.cwd });
  const prUrl = await runner(
    'gh',
    [
      'pr',
      'create',
      '--base',
      base,
      '--head',
      task.branchName,
      '--title',
      task.title,
      '--body-file',
      snapshotPath
    ],
    { cwd: options.cwd }
  );

  return {
    taskId: task.id,
    branchName: task.branchName,
    snapshotPath,
    prUrl
  };
}

export async function createGithubPackage(options: GithubPackageOptions): Promise<GithubPackageResult> {
  const task = await requireActiveTask(options.cwd);
  const snapshotPath = await latestSnapshotPath(options.cwd, task.id);
  if (!snapshotPath) {
    throw new Error('生成 GitHub 交接包前需要先生成 snapshot。');
  }

  const base = options.base ?? task.baseBranch;
  const packagePath = path.join(options.cwd, bridgeDirName, 'tasks', task.id, 'github-pr-package.md');
  const markdown = [
    '# GitHub PR 交接包',
    '',
    `任务 ID：${task.id}`,
    `PR 标题：${task.title}`,
    `任务分支：${task.branchName}`,
    `目标分支：${base}`,
    `PR Body 文件：${snapshotPath}`,
    '',
    '## 发布命令',
    '',
    fence(['git push -u origin ' + task.branchName, `gh pr create --base ${base} --head ${task.branchName} --title "${task.title}" --body-file "${snapshotPath}"`].join('\n')),
    '',
    '## 给 ChatGPT 的评审提示',
    '',
    `请读取这个 PR，帮我评审这次 Codex 修改是否合理。重点看风险点、遗漏测试、回滚风险，以及是否需要继续修改。PR 标题是「${task.title}」，任务分支是 \`${task.branchName}\`，Bridge 生成的结果包在 PR body 中。`,
    ''
  ].join('\n');

  await writeFile(packagePath, markdown, 'utf8');

  return {
    taskId: task.id,
    path: packagePath,
    snapshotPath,
    title: task.title
  };
}

export async function checkBridgeEnvironment(options: EnvironmentDiagnosticsOptions): Promise<EnvironmentDiagnostics> {
  const runner = options.runner ?? runTool;
  const checks = [
    await checkTool('Git CLI', () => runner('git', ['--version'], { cwd: options.cwd }), '未检测到 git'),
    {
      name: 'Git 仓库',
      ok: await isGitRepository(options.cwd),
      detail: (await isGitRepository(options.cwd)) ? '当前目录是 Git 仓库' : '当前目录不是 Git 仓库'
    },
    await checkTool('GitHub CLI', () => runner('gh', ['--version'], { cwd: options.cwd }), '未检测到 gh，请先安装并登录 GitHub CLI'),
    await checkTool('origin remote', () => runner('git', ['remote', 'get-url', 'origin'], { cwd: options.cwd }), '未配置 origin remote，无法 push 任务分支')
  ];

  return {
    readyForLocalGit: checks[0].ok && checks[1].ok,
    readyForGithub: checks.every((check) => check.ok),
    checks
  };
}

function slugify(input: string, isoDate: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || `task-${compactTime(isoDate)}`;
}

function compactDate(isoDate: string): string {
  return isoDate.slice(0, 10).replaceAll('-', '');
}

function compactTime(isoDate: string): string {
  return isoDate.slice(11, 19).replaceAll(':', '');
}

function fence(value: string): string {
  return `\`\`\`\n${value}\n\`\`\``;
}

async function requireActiveTask(cwd: string): Promise<BridgeTask> {
  const task = await readActiveTask(cwd);
  if (!task) {
    throw new Error('No active WebCodexBridge task found.');
  }
  return task;
}

async function backupBridgeMetadata(cwd: string): Promise<{ tempDir: string; bridgeBackupDir: string }> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wcb-rollback-'));
  const bridgeBackupDir = path.join(tempDir, bridgeDirName);
  await cp(path.join(cwd, bridgeDirName), bridgeBackupDir, { recursive: true, force: true });
  return { tempDir, bridgeBackupDir };
}

async function restoreBridgeMetadata(cwd: string, backup: { bridgeBackupDir: string }): Promise<void> {
  await cp(backup.bridgeBackupDir, path.join(cwd, bridgeDirName), { recursive: true, force: true });
}

async function checkTool(name: string, probe: () => Promise<string>, missingDetail: string) {
  try {
    const output = await probe();
    return {
      name,
      ok: true,
      detail: output || '可用'
    };
  } catch {
    return {
      name,
      ok: false,
      detail: missingDetail
    };
  }
}

function isOnlyGithubPackageDirty(statusShort: string, taskId: string): boolean {
  const allowedPath = `.webcodexbridge/tasks/${taskId}/github-pr-package.md`;
  return statusShort
    .split('\n')
    .filter(Boolean)
    .every((line) => line.slice(3) === allowedPath);
}
