import { describe, expect, it } from 'vitest';
import { runBasePinnedTests, type BasePinOptions } from '../src/basePin';
import type { ExecResult } from '../src/testRunner';
import type { ChangedFile, TestResult } from '../src/types';
import { changedFile, patchOf, srcChange } from './helpers';

const passing: TestResult = { ran: true, command: 'npm test', passed: true, exitCode: 0 };
const modifiedTest = changedFile('tests/core.test.ts', patchOf('-old', '+new'));

function makeExec(respond: (cmd: string) => ExecResult = () => ({ exitCode: 0, output: 'ok' })) {
  const calls: string[] = [];
  return {
    calls,
    exec: async (cmd: string): Promise<ExecResult> => {
      calls.push(cmd);
      return respond(cmd);
    },
  };
}

function options(overrides: Partial<BasePinOptions> = {}): BasePinOptions {
  return {
    mode: 'auto',
    files: [srcChange, modifiedTest],
    baseRef: 'main',
    normal: passing,
    cwd: '.',
    exec: makeExec().exec,
    log: { info: () => {}, warning: () => {} },
    ...overrides,
  };
}

describe('runBasePinnedTests', () => {
  it('does nothing when disabled', async () => {
    const { exec, calls } = makeExec();
    const result = await runBasePinnedTests(options({ mode: 'off', exec }));
    expect(result).toMatchObject({ ran: false, regression: false });
    expect(calls).toEqual([]);
  });

  it('skips in auto mode when no existing test files were modified', async () => {
    const result = await runBasePinnedTests(options({ files: [srcChange] }));
    expect(result.ran).toBe(false);
    expect(result.reason).toContain('no existing test files');
  });

  it('skips when the normal suite already failed', async () => {
    const result = await runBasePinnedTests(
      options({ normal: { ...passing, passed: false, exitCode: 1 } }),
    );
    expect(result.ran).toBe(false);
    expect(result.reason).toContain('already failing');
  });

  it('fetches base, restores test files, reruns, and resets', async () => {
    const { exec, calls } = makeExec();
    const result = await runBasePinnedTests(options({ exec }));
    expect(result).toMatchObject({ ran: true, regression: false, passed: true });
    expect(calls[0]).toContain("git fetch --depth=1 origin 'main'");
    expect(calls[1]).toContain("git checkout FETCH_HEAD -- 'tests/core.test.ts'");
    expect(calls[2]).toBe('npm test');
    expect(calls[3]).toContain('git reset --hard');
  });

  it('reports a regression when the pinned run fails', async () => {
    const { exec, calls } = makeExec((cmd) =>
      cmd === 'npm test' ? { exitCode: 1, output: '2 failing' } : { exitCode: 0, output: '' },
    );
    const result = await runBasePinnedTests(options({ exec }));
    expect(result).toMatchObject({ ran: true, regression: true, passed: false });
    expect(calls.at(-1)).toContain('git reset --hard');
  });

  it('skips gracefully when the base ref cannot be fetched', async () => {
    const { exec, calls } = makeExec((cmd) =>
      cmd.startsWith('git fetch') ? { exitCode: 128, output: 'not found' } : { exitCode: 0, output: '' },
    );
    const result = await runBasePinnedTests(options({ exec }));
    expect(result.ran).toBe(false);
    expect(result.reason).toContain('fetch');
    expect(calls.some((c) => c.includes('git checkout'))).toBe(false);
  });

  it('restores deleted test files and the pre-rename path of renamed ones', async () => {
    const files: ChangedFile[] = [
      srcChange,
      { filename: 'tests/gone.test.ts', status: 'removed', additions: 0, deletions: 10 },
      {
        filename: 'tests/new-name.test.ts',
        previousFilename: 'tests/old-name.test.ts',
        status: 'renamed',
        additions: 1,
        deletions: 1,
        patch: patchOf('-a', '+b'),
      },
    ];
    const { exec, calls } = makeExec();
    await runBasePinnedTests(options({ files, exec }));
    const checkout = calls.find((c) => c.startsWith('git checkout'));
    expect(checkout).toContain("'tests/gone.test.ts'");
    expect(checkout).toContain("'tests/old-name.test.ts'");
    expect(checkout).not.toContain("'tests/new-name.test.ts'");
  });
});
