import { describe, expect, it } from 'vitest';
import {
  computePatchCoverage,
  findCoverageFile,
  parseCoverage,
  parseGoCover,
  parseLcov,
} from '../src/coverage';
import type { ChangedFile } from '../src/types';
import type { FsLike } from '../src/testRunner';

const LCOV = `TN:
SF:src/math.ts
DA:1,2
DA:2,0
DA:5,1
end_of_record
SF:/home/runner/work/repo/repo/src/util.ts
DA:10,0
DA:11,3
end_of_record`;

const GO_COVER = `mode: count
github.com/acme/proj/pkg/calc.go:10.2,12.16 2 1
github.com/acme/proj/pkg/calc.go:14.2,14.10 1 0`;

function fileWithAddedLines(
  filename: string,
  startLine: number,
  count: number,
): ChangedFile {
  const lines = Array.from({ length: count }, (_, i) => `+line ${i}`);
  return {
    filename,
    status: 'modified',
    additions: count,
    deletions: 0,
    patch: [`@@ -0,0 +${startLine},${count} @@`, ...lines].join('\n'),
  };
}

describe('parseLcov', () => {
  it('parses DA records per file', () => {
    const data = parseLcov(LCOV);
    expect(data.files.get('src/math.ts')?.get(1)).toBe(2);
    expect(data.files.get('src/math.ts')?.get(2)).toBe(0);
    expect(data.files.get('src/math.ts')?.get(5)).toBe(1);
    expect(data.files.get('/home/runner/work/repo/repo/src/util.ts')?.get(11)).toBe(3);
  });

  it('keeps the max hit count for duplicate records', () => {
    const data = parseLcov('SF:a.ts\nDA:1,0\nDA:1,4\nend_of_record');
    expect(data.files.get('a.ts')?.get(1)).toBe(4);
  });
});

describe('parseGoCover', () => {
  it('expands statement blocks into per-line hits', () => {
    const data = parseGoCover(GO_COVER);
    const calc = data.files.get('github.com/acme/proj/pkg/calc.go');
    expect(calc?.get(10)).toBe(1);
    expect(calc?.get(11)).toBe(1);
    expect(calc?.get(12)).toBe(1);
    expect(calc?.get(14)).toBe(0);
  });
});

describe('parseCoverage', () => {
  it('dispatches on the Go "mode:" header', () => {
    expect(parseCoverage(GO_COVER).files.size).toBe(1);
    expect(parseCoverage(LCOV).files.size).toBe(2);
  });
});

describe('computePatchCoverage', () => {
  it('counts covered and uncovered added lines, skipping uninstrumented ones', () => {
    // Added lines 1-5 in src/math.ts: 1 covered, 2 uncovered, 3-4 not in
    // report (comments/blanks), 5 covered.
    const result = computePatchCoverage([fileWithAddedLines('src/math.ts', 1, 5)], parseLcov(LCOV));
    expect(result.computed).toBe(true);
    expect(result.coveredLines).toBe(2);
    expect(result.totalLines).toBe(3);
    expect(result.percent).toBeCloseTo(66.7, 1);
    expect(result.files?.[0]?.uncoveredLines).toEqual([2]);
  });

  it('matches repo-relative PR paths against absolute report paths', () => {
    const result = computePatchCoverage(
      [fileWithAddedLines('src/util.ts', 10, 2)],
      parseLcov(LCOV),
    );
    expect(result.totalLines).toBe(2);
    expect(result.coveredLines).toBe(1);
  });

  it('matches Go module-prefixed paths', () => {
    const files = [
      {
        filename: 'pkg/calc.go',
        status: 'modified',
        additions: 2,
        deletions: 0,
        patch: '@@ -0,0 +10,1 @@\n+a\n@@ -0,0 +14,1 @@\n+b',
      } as ChangedFile,
    ];
    const result = computePatchCoverage(files, parseGoCover(GO_COVER));
    expect(result.coveredLines).toBe(1);
    expect(result.totalLines).toBe(2);
  });

  it('ignores test files, docs, and removed files', () => {
    const files: ChangedFile[] = [
      fileWithAddedLines('tests/math.test.ts', 1, 3),
      fileWithAddedLines('README.md', 1, 3),
      { filename: 'src/old.ts', status: 'removed', additions: 0, deletions: 9 },
    ];
    const result = computePatchCoverage(files, parseLcov(LCOV));
    expect(result.totalLines).toBe(0);
    expect(result.percent).toBeUndefined();
  });

  it('reports source files missing from the coverage report separately', () => {
    const result = computePatchCoverage(
      [fileWithAddedLines('src/never-imported.ts', 1, 4)],
      parseLcov(LCOV),
    );
    expect(result.unmatchedFiles).toEqual(['src/never-imported.ts']);
    expect(result.totalLines).toBe(0);
  });
});

describe('findCoverageFile', () => {
  const fs = (files: string[]): FsLike => ({
    exists: (p) => files.includes(p),
    read: () => '',
  });

  it('prefers an explicit path', () => {
    expect(findCoverageFile('/repo', fs(['/repo/out/cov.info']), 'out/cov.info')).toBe(
      '/repo/out/cov.info',
    );
  });

  it('auto-detects common locations', () => {
    expect(findCoverageFile('/repo', fs(['/repo/coverage/lcov.info']))).toBe(
      '/repo/coverage/lcov.info',
    );
    expect(findCoverageFile('/repo', fs(['/repo/coverage.out']))).toBe('/repo/coverage.out');
    expect(findCoverageFile('/repo', fs([]))).toBeUndefined();
  });
});
