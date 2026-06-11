import { describe, expect, it } from 'vitest';
import { detectCiTampering } from '../../src/detectors/ciTampering';
import type { ChangedFile } from '../../src/types';
import { changedFile, patchOf } from '../helpers';

describe('detectCiTampering', () => {
  it('flags removal of a test step from a workflow as high', () => {
    const files: ChangedFile[] = [
      changedFile('.github/workflows/ci.yml', patchOf('-      - run: npm test')),
    ];
    const findings = detectCiTampering(files);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'ci-tampering', severity: 'high' });
  });

  it('flags continue-on-error: true added to a workflow', () => {
    const files: ChangedFile[] = [
      changedFile('.github/workflows/ci.yml', patchOf('+        continue-on-error: true')),
    ];
    expect(detectCiTampering(files)[0]?.severity).toBe('high');
  });

  it('flags steps disabled with if: false', () => {
    const files: ChangedFile[] = [
      changedFile('.github/workflows/ci.yml', patchOf("+        if: false")),
    ];
    expect(detectCiTampering(files)[0]?.severity).toBe('high');
  });

  it('flags a deleted workflow file as high', () => {
    const files: ChangedFile[] = [
      { filename: '.github/workflows/ci.yml', status: 'removed', additions: 0, deletions: 30 },
    ];
    expect(detectCiTampering(files)[0]).toMatchObject({
      rule: 'ci-tampering',
      severity: 'high',
      message: expect.stringContaining('deleted'),
    });
  });

  it('reports an innocuous workflow edit as medium', () => {
    const files: ChangedFile[] = [
      changedFile(
        '.github/workflows/ci.yml',
        patchOf('-          node-version: 18', '+          node-version: 20'),
      ),
    ];
    const findings = detectCiTampering(files);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'medium', message: 'CI configuration modified' });
  });

  it('flags lowered coverage thresholds as high', () => {
    const files: ChangedFile[] = [
      changedFile(
        'jest.config.js',
        patchOf('-      branches: 80,', '+      branches: 40,'),
      ),
    ];
    const findings = detectCiTampering(files);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'coverage-lowered',
      severity: 'high',
      evidence: 'branches: 80 → 40',
    });
  });

  it('flags a neutered npm test script as high', () => {
    const files: ChangedFile[] = [
      changedFile(
        'package.json',
        patchOf('-    "test": "vitest run",', '+    "test": "echo \\"ok\\"",'),
      ),
    ];
    const findings = detectCiTampering(files);
    expect(findings.map((f) => f.rule)).toContain('test-script-neutered');
    expect(findings[0]?.severity).toBe('high');
  });

  it('reports a reworked (non-neutered) test script as medium', () => {
    const files: ChangedFile[] = [
      changedFile(
        'package.json',
        patchOf('-    "test": "jest",', '+    "test": "vitest run",'),
      ),
    ];
    expect(detectCiTampering(files)[0]).toMatchObject({
      rule: 'test-script-modified',
      severity: 'medium',
    });
  });

  it('ignores package.json changes that do not touch test scripts', () => {
    const files: ChangedFile[] = [
      changedFile(
        'package.json',
        patchOf('-    "lodash": "^4.17.20",', '+    "lodash": "^4.17.21",'),
      ),
    ];
    expect(detectCiTampering(files)).toEqual([]);
  });

  it('reports modified test config without threshold changes as medium', () => {
    const files: ChangedFile[] = [
      changedFile('vitest.config.ts', patchOf("+    pool: 'threads',")),
    ];
    expect(detectCiTampering(files)[0]).toMatchObject({
      severity: 'medium',
      message: 'Test configuration modified',
    });
  });

  it('ignores newly added CI files', () => {
    const files: ChangedFile[] = [
      changedFile('.github/workflows/lint.yml', patchOf('+name: lint'), 'added'),
    ];
    expect(detectCiTampering(files)).toEqual([]);
  });
});
