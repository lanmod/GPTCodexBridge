export type BridgeConfig = {
  version: 1;
  branchPrefix: string;
  tasksDir: string;
};

export type CommandContext = {
  cwd: string;
};

export type InitResult = {
  configPath: string;
  tasksPath: string;
};

export type TaskStatus = 'created' | 'committed' | 'rolled_back';

export type BridgeTask = {
  id: string;
  slug: string;
  title: string;
  description: string;
  baseBranch: string;
  baseCommit: string;
  branchName: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  latestSnapshotPath?: string;
  latestSnapshotDiffHash?: string;
  committedAt?: string;
};

export type CreateTaskOptions = CommandContext & {
  title: string;
  description: string;
  checkout?: boolean;
  allowDirty?: boolean;
};

export type BridgeStatus = {
  branch: string;
  isDirty: boolean;
  statusShort: string;
  activeTask: BridgeTask | null;
  latestSnapshotPath: string | null;
};

export type SnapshotOptions = CommandContext & {
  verifyCommand?: string;
};

export type SnapshotResult = {
  taskId: string;
  path: string;
  diffHash: string;
};

export type CommitResult = {
  taskId: string;
  commit: string;
  message: string;
};

export type RollbackOptions = CommandContext & {
  force?: boolean;
};

export type RollbackResult = {
  taskId: string;
  baseCommit: string;
};

export type ToolRunner = (
  tool: string,
  args: string[],
  options: { cwd: string }
) => Promise<string>;

export type GithubPublishOptions = CommandContext & {
  base?: string;
  runner?: ToolRunner;
};

export type GithubPublishResult = {
  taskId: string;
  branchName: string;
  snapshotPath: string;
  prUrl: string;
};

export type GithubPackageOptions = CommandContext & {
  base?: string;
};

export type GithubPackageResult = {
  taskId: string;
  path: string;
  snapshotPath: string;
  title: string;
};

export type CodexPromptOptions = CommandContext & {
  verifyCommand?: string;
};

export type CodexPromptResult = {
  taskId: string;
  path: string;
};

export type EnvironmentCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type EnvironmentDiagnosticsOptions = CommandContext & {
  runner?: ToolRunner;
};

export type EnvironmentDiagnostics = {
  readyForLocalGit: boolean;
  readyForGithub: boolean;
  checks: EnvironmentCheck[];
};
