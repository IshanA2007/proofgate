import { describe, expect, it } from 'vitest';
import { detectWeakenedAssertions } from '../../src/detectors/weakenedAssertions';
import type { ChangedFile } from '../../src/types';
import { changedFile, patchOf, srcChange } from '../helpers';

describe('detectWeakenedAssertions', () => {
  it('flags a net drop in assertions in a modified test file', () => {
    const files: ChangedFile[] = [
      srcChange,
      changedFile(
        'tests/parse.test.ts',
        patchOf(
          '-    expect(result.ok).toBe(true);',
          '-    expect(result.errors).toHaveLength(0);',
        ),
      ),
    ];
    const findings = detectWeakenedAssertions(files);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'weakened-assertions',
      severity: 'medium',
      message: 'Net 2 assertion(s) removed',
    });
  });

  it('escalates to high for 5+ net removed assertions with source changes', () => {
    const removed = Array.from({ length: 5 }, (_, i) => `-    expect(out[${i}]).toBe(${i});`);
    const files: ChangedFile[] = [
      srcChange,
      changedFile('tests/parse.test.ts', patchOf(...removed)),
    ];
    expect(detectWeakenedAssertions(files)[0]?.severity).toBe('high');
  });

  it('flags trivial always-true assertions as high severity', () => {
    const files: ChangedFile[] = [
      srcChange,
      changedFile('tests/auth.test.ts', patchOf('+    expect(true).toBe(true);')),
    ];
    const findings = detectWeakenedAssertions(files);
    expect(findings.some((f) => f.rule === 'trivial-assertion' && f.severity === 'high')).toBe(
      true,
    );
  });

  it('flags expect(x).toBe(x) self-comparisons', () => {
    const files: ChangedFile[] = [
      srcChange,
      changedFile('tests/auth.test.ts', patchOf('+    expect(result).toEqual(result);')),
    ];
    expect(detectWeakenedAssertions(files).map((f) => f.rule)).toContain('trivial-assertion');
  });

  it('flags python "assert True"', () => {
    const files: ChangedFile[] = [
      srcChange,
      changedFile('tests/test_auth.py', patchOf('+    assert True')),
    ];
    expect(detectWeakenedAssertions(files).map((f) => f.rule)).toContain('trivial-assertion');
  });

  it('does not flag balanced assertion refactors', () => {
    const files: ChangedFile[] = [
      srcChange,
      changedFile(
        'tests/parse.test.ts',
        patchOf('-    expect(value).toBe(1);', '+    expect(value).toBe(2);'),
      ),
    ];
    expect(detectWeakenedAssertions(files)).toEqual([]);
  });

  it('ignores brand-new test files for net-drop accounting', () => {
    const files: ChangedFile[] = [
      changedFile('tests/new.test.ts', patchOf('+    expect(run()).toBe(1);'), 'added'),
    ];
    expect(detectWeakenedAssertions(files)).toEqual([]);
  });
});
