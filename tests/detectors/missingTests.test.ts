import { describe, expect, it } from 'vitest';
import { detectMissingTests } from '../../src/detectors/missingTests';
import { changedFile, patchOf, srcChange } from '../helpers';

describe('detectMissingTests', () => {
  it('flags source changes with no test files touched', () => {
    const findings = detectMissingTests([srcChange]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'missing-tests', severity: 'medium' });
  });

  it('stays quiet when any test file changed', () => {
    const files = [srcChange, changedFile('tests/core.test.ts', patchOf('+it("x", () => {})'))];
    expect(detectMissingTests(files)).toEqual([]);
  });

  it('stays quiet for non-source PRs', () => {
    expect(detectMissingTests([changedFile('README.md', patchOf('+docs'))])).toEqual([]);
  });
});
