import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const codeDiffPathspec = ['--', '.', ':!.webcodexbridge/**'];

export async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trimEnd();
}

export async function runTool(tool: string, args: string[], options: { cwd: string }): Promise<string> {
  const { stdout } = await execFileAsync(tool, args, { cwd: options.cwd });
  return stdout.trimEnd();
}

export async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    const output = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
    return output === 'true';
  } catch {
    return false;
  }
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  return runGit(cwd, ['branch', '--show-current']);
}

export async function getHeadCommit(cwd: string): Promise<string> {
  return runGit(cwd, ['rev-parse', 'HEAD']);
}

export async function createAndCheckoutBranch(cwd: string, branchName: string): Promise<void> {
  await runGit(cwd, ['switch', '-c', branchName]);
}

export async function getStatusShort(cwd: string): Promise<string> {
  return runGit(cwd, ['status', '--short']);
}

export async function getDiffStat(cwd: string): Promise<string> {
  return runGit(cwd, ['diff', '--stat']);
}

export async function getDiff(cwd: string): Promise<string> {
  return runGit(cwd, ['diff']);
}

export async function getCodeDiffStatAgainstHead(cwd: string): Promise<string> {
  return runGit(cwd, ['diff', '--stat', 'HEAD', ...codeDiffPathspec]);
}

export async function getCodeDiffAgainstHead(cwd: string): Promise<string> {
  return runGit(cwd, ['diff', 'HEAD', ...codeDiffPathspec]);
}

export async function stageAll(cwd: string): Promise<void> {
  await runGit(cwd, ['add', '-A']);
}

export async function commit(cwd: string, message: string): Promise<string> {
  await runGit(cwd, ['commit', '-m', message]);
  return getHeadCommit(cwd);
}

export async function resetHard(cwd: string, commitRef: string): Promise<void> {
  await runGit(cwd, ['reset', '--hard', commitRef]);
}

export async function runShell(cwd: string, command: string): Promise<{ exitCode: number; output: string }> {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd });
    return { exitCode: 0, output: `${stdout}${stderr}`.trimEnd() };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const err = error as { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: typeof err.code === 'number' ? err.code : 1,
        output: `${err.stdout ?? ''}${err.stderr ?? ''}`.trimEnd()
      };
    }
    throw error;
  }
}
