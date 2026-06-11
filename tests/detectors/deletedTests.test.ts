import { describe, expect, it } from 'vitest';
import { detectDeletedTests } from '../../src/detectors/deletedTests';
import type { ChangedFile } from '../../src/types';
import { changedFile, patchOf, srcChange } from '../helpers';

describe('detectDeletedTests', () => {
  it('flags a deleted test file as high severity when source also changed', () => {
    const files: ChangedFile[] = [
      srcChange,
      { filename: 'tests/core.test.ts', status: 'removed', additions: 0, deletions: 80 },
    ];
    const findings = detectDeletedTests(files);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'deleted-tests',
      severity: 'high',
      file: 'tests/core.test.ts',
    });
  });

  it('flags a deleted test file as medium severity in a test-only PR', () => {
    const files: ChangedFile[] = [
      { filename: 'tests/legacy.test.ts', status: 'removed', additions: 0, deletions: 40 },
    ];
    expect(detectDeletedTests(files)[0]?.severity).toBe('medium');
  });

  it('flags net removal of test cases from a modified test file', () => {
    const files: ChangedFile[] = [
      srcChange,
      changedFile(
        'tests/math.test.ts',
        patchOf(
          "-  it('adds', () => {",
          '-    expect(add(1, 2)).toBe(3);',
          '-  });',
          "-  it('subtracts', () => {",
          '-    expect(sub(3, 2)).toBe(1);',
          '-  });',
        ),
      ),
    ];
    const findings = detectDeletedTests(files);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'deleted-tests',
      severity: 'medium',
      message: '2 test case(s) removed',
    });
  });

  it('escalates to high when 3+ test cases are removed alongside source changes', () => {
    const files: ChangedFile[] = [
      srcChange,
      changedFile(
        'tests/math.test.ts',
        patchOf(
          "-  it('adds', () => {});",
          "-  it('subtracts', () => {});",
          "-  it('multiplies', () => {});",
        ),
      ),
    ];
    expect(detectDeletedTests(files)[0]?.severity).toBe('high');
  });

  it('does not flag renames where the test count is unchanged', () => {
    const files: ChangedFile[] = [
      srcChange,
      changedFile(
        'tests/math.test.ts',
        patchOf("-  it('old name', () => {", "+  it('new, clearer name', () => {"),
      ),
    ];
    expect(detectDeletedTests(files)).toEqual([]);
  });

  it('does not flag PRs that only add tests', () => {
    const files: ChangedFile[] = [
      changedFile(
        'tests/new.test.ts',
        patchOf("+  it('covers the new case', () => {", '+    expect(run()).toBe(1);', '+  });'),
        'added',
      ),
    ];
    expect(detectDeletedTests(files)).toEqual([]);
  });

  it('recognizes non-JS test declarations (pytest, go)', () => {
    const files: ChangedFile[] = [
      srcChange,
      changedFile('tests/test_api.py', patchOf('-def test_handles_empty_payload():')),
      changedFile('pkg/server_test.go', patchOf('-func TestRetryBackoff(t *testing.T) {')),
    ];
    const findings = detectDeletedTests(files);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.file)).toEqual(['tests/test_api.py', 'pkg/server_test.go']);
  });
});
