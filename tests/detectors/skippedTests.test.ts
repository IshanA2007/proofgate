import { describe, expect, it } from 'vitest';
import { detectSkippedTests } from '../../src/detectors/skippedTests';
import type { ChangedFile } from '../../src/types';
import { changedFile, patchOf, srcChange } from '../helpers';

describe('detectSkippedTests', () => {
  it('flags it.skip added to an existing test file as high when source changed', () => {
    const files: ChangedFile[] = [
      srcChange,
      changedFile(
        'tests/validate.test.ts',
        patchOf("+  it.skip('rejects malformed input', () => {"),
      ),
    ];
    const findings = detectSkippedTests(files);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'skipped-tests',
      severity: 'high',
      file: 'tests/validate.test.ts',
      line: 1,
    });
  });

  it('flags .only because it silently excludes every other test', () => {
    const files: ChangedFile[] = [
      srcChange,
      changedFile('tests/fast.test.ts', patchOf("+describe.only('fast suite', () => {")),
    ];
    const findings = detectSkippedTests(files);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('.only');
  });

  it('flags pytest skip markers', () => {
    const files: ChangedFile[] = [
      srcChange,
      changedFile('tests/test_api.py', patchOf("+@pytest.mark.skip(reason='flaky')")),
    ];
    expect(detectSkippedTests(files)[0]?.severity).toBe('high');
  });

  it('flags Go t.Skip calls', () => {
    const files: ChangedFile[] = [
      srcChange,
      changedFile('pkg/server_test.go', patchOf('+\tt.Skip("temporarily disabled")')),
    ];
    expect(detectSkippedTests(files)).toHaveLength(1);
  });

  it('downgrades to medium for test-only PRs', () => {
    const files: ChangedFile[] = [
      changedFile('tests/flaky.test.ts', patchOf("+it.skip('flaky on CI', () => {")),
    ];
    expect(detectSkippedTests(files)[0]?.severity).toBe('medium');
  });

  it('downgrades to medium in brand-new test files', () => {
    const files: ChangedFile[] = [
      srcChange,
      changedFile('tests/wip.test.ts', patchOf("+it.todo('cover the error path')"), 'added'),
    ];
    expect(detectSkippedTests(files)[0]?.severity).toBe('medium');
  });

  it('ignores non-test files entirely', () => {
    const files: ChangedFile[] = [
      changedFile('src/lexer.ts', patchOf('+  reader.skip(3);')),
    ];
    expect(detectSkippedTests(files)).toEqual([]);
  });

  it('does not flag removed skip lines (un-skipping a test)', () => {
    const files: ChangedFile[] = [
      srcChange,
      changedFile(
        'tests/validate.test.ts',
        patchOf("-  it.skip('rejects malformed input', () => {", "+  it('rejects malformed input', () => {"),
      ),
    ];
    expect(detectSkippedTests(files)).toEqual([]);
  });
});
