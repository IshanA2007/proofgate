import { isTestConfigFile, isTestFile } from './classify';
import { tailOutput, type ExecFn } from './testRunner';
import type { ChangedFile, PinSummary, TestResult } from './types';

export type PinMode = 'auto' | 'always' | 'off';

export interface BasePinOptions {
  mode: PinMode;
  files: ChangedFile[];
  baseRef?: string;
  /** Result of the normal (PR) test run, including the resolved command. */
  normal: TestResult;
  cwd: string;
  exec: ExecFn;
  log: { info(msg: string): void; warning(msg: string): void };
}

export interface PinResult extends PinSummary {
  restoredFiles?: string[];
  tests?: TestResult;
}

function skip(reason: string): PinResult {
  return { ran: false, regression: false, reason };
}

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Base-branch test pinning: restore the base branch's versions of every test
 * file the PR modified or deleted, rerun the suite against the PR's source,
 * and reset the tree afterwards. The contributor cannot weaken tests they do
 * not control, so "PR suite passes but base-pinned suite fails" is direct
 * evidence the PR rewrote tests to hide a regression.
 */
export async function runBasePinnedTests(opts: BasePinOptions): Promise<PinResult> {
  if (opts.mode === 'off') return skip('disabled (base-test-pinning: off)');

  const candidates = opts.files.filter(
    (f) =>
      (isTestFile(f.filename) || isTestConfigFile(f.filename)) &&
      f.status !== 'added' &&
      f.status !== 'unchanged',
  );
  if (candidates.length === 0) return skip('no existing test files were modified by this PR');
  if (!opts.normal.ran || !opts.normal.command) return skip('test suite did not run');
  if (opts.normal.passed === false) return skip('test suite is already failing');
  if (!opts.baseRef) return skip('base ref unknown');

  // For renames, the base branch only knows the pre-rename path.
  const paths = candidates.map((f) =>
    f.status === 'renamed' && f.previousFilename ? f.previousFilename : f.filename,
  );

  const reset = async () => {
    try {
      await opts.exec('git reset --hard HEAD', opts.cwd);
    } catch (err) {
      opts.log.warning(`Could not reset the worktree after the pinned run: ${String(err)}`);
    }
  };

  try {
    const fetch = await opts.exec(`git fetch --depth=1 origin ${sq(opts.baseRef)}`, opts.cwd);
    if (fetch.exitCode !== 0) {
      // No reset needed: fetch never touches the worktree or index.
      return skip(`could not fetch base ref "${opts.baseRef}" (git exit ${fetch.exitCode})`);
    }
    const checkout = await opts.exec(
      `git checkout FETCH_HEAD -- ${paths.map(sq).join(' ')}`,
      opts.cwd,
    );
    if (checkout.exitCode !== 0) {
      await reset();
      return skip(`could not restore base test files (git exit ${checkout.exitCode})`);
    }

    opts.log.info(
      `Base-pinned run: restored ${paths.length} test file(s) from ${opts.baseRef}, rerunning "${opts.normal.command}"`,
    );
    const start = Date.now();
    const run = await opts.exec(opts.normal.command, opts.cwd);
    const tests: TestResult = {
      ran: true,
      command: opts.normal.command,
      passed: run.exitCode === 0,
      exitCode: run.exitCode,
      durationMs: Date.now() - start,
      outputTail: tailOutput(run.output),
    };
    await reset();
    return {
      ran: true,
      regression: tests.passed === false,
      passed: tests.passed,
      tests,
      restoredFiles: paths,
    };
  } catch (err) {
    await reset();
    return skip(`git error: ${String(err)}`);
  }
}
