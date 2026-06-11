import { isSourceFile } from './classify';
import { parsePatch } from './diff';
import type { FsLike } from './testRunner';
import type { ChangedFile, FilePatchCoverage, PatchCoverage } from './types';

export interface CoverageData {
  /** report path -> line number -> hit count */
  files: Map<string, Map<number, number>>;
}

function linesOf(data: CoverageData, path: string): Map<number, number> {
  let lines = data.files.get(path);
  if (!lines) {
    lines = new Map();
    data.files.set(path, lines);
  }
  return lines;
}

function recordHit(lines: Map<number, number>, line: number, hits: number): void {
  lines.set(line, Math.max(lines.get(line) ?? 0, hits));
}

/** Parses lcov tracefiles (`SF:`/`DA:` records) — the lingua franca emitted by
 * c8/nyc/vitest/jest, pytest-cov, cargo-llvm-cov, simplecov-lcov, etc. */
export function parseLcov(content: string): CoverageData {
  const data: CoverageData = { files: new Map() };
  let current: Map<number, number> | undefined;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      current = linesOf(data, line.slice(3).trim());
    } else if (line.startsWith('DA:') && current) {
      const [lineNo, hits] = line.slice(3).split(',');
      const n = Number(lineNo);
      const h = Number(hits);
      if (Number.isFinite(n) && Number.isFinite(h)) recordHit(current, n, h);
    } else if (line === 'end_of_record') {
      current = undefined;
    }
  }
  return data;
}

const GO_BLOCK = /^(.+):(\d+)\.\d+,(\d+)\.\d+ \d+ (\d+)$/;

/** Parses Go's native coverprofile format (`go test -coverprofile=...`). */
export function parseGoCover(content: string): CoverageData {
  const data: CoverageData = { files: new Map() };
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('mode:')) continue;
    const m = GO_BLOCK.exec(line);
    if (!m) continue;
    const lines = linesOf(data, m[1]!);
    const start = Number(m[2]);
    const end = Number(m[3]);
    const count = Number(m[4]);
    for (let l = start; l <= end; l++) recordHit(lines, l, count);
  }
  return data;
}

export function parseCoverage(content: string): CoverageData {
  return content.trimStart().startsWith('mode:') ? parseGoCover(content) : parseLcov(content);
}

const COVERAGE_CANDIDATES = [
  'lcov.info',
  'coverage/lcov.info',
  'coverage.lcov',
  'coverage/lcov/lcov.info',
  'coverage.out',
];

export function findCoverageFile(
  cwd: string,
  fs: FsLike,
  explicit?: string,
): string | undefined {
  if (explicit) {
    const path = explicit.startsWith('/') ? explicit : `${cwd}/${explicit}`;
    return fs.exists(path) ? path : undefined;
  }
  for (const candidate of COVERAGE_CANDIDATES) {
    const path = `${cwd}/${candidate}`;
    if (fs.exists(path)) return path;
  }
  return undefined;
}

/** Coverage reports use absolute, relative, or Go-module-prefixed paths;
 * PR filenames are repo-relative. Match by the longest path suffix. */
function matchEntry(data: CoverageData, prFile: string): Map<number, number> | undefined {
  const exact = data.files.get(prFile);
  if (exact) return exact;
  const suffix = `/${prFile}`;
  let best: Map<number, number> | undefined;
  let bestLen = -1;
  for (const [path, lines] of data.files) {
    if (path.endsWith(suffix) && path.length > bestLen) {
      best = lines;
      bestLen = path.length;
    }
  }
  return best;
}

/**
 * Intersects the PR's added lines with the coverage report: every added line
 * in a source file is covered, uncovered, or uninstrumentable (comments,
 * blanks — excluded from the denominator).
 */
export function computePatchCoverage(
  files: ChangedFile[],
  coverage: CoverageData,
  reportFile?: string,
): PatchCoverage {
  const perFile: FilePatchCoverage[] = [];
  const unmatchedFiles: string[] = [];
  let covered = 0;
  let total = 0;

  for (const f of files) {
    if (!isSourceFile(f.filename) || f.status === 'removed') continue;
    const { added } = parsePatch(f.patch);
    if (added.length === 0) continue;

    const entry = matchEntry(coverage, f.filename);
    if (!entry) {
      unmatchedFiles.push(f.filename);
      continue;
    }

    const fileCov: FilePatchCoverage = {
      file: f.filename,
      covered: 0,
      uncovered: 0,
      uncoveredLines: [],
    };
    for (const line of added) {
      const hits = entry.get(line.line);
      if (hits === undefined) continue;
      if (hits > 0) fileCov.covered++;
      else {
        fileCov.uncovered++;
        fileCov.uncoveredLines.push(line.line);
      }
    }
    if (fileCov.covered + fileCov.uncovered > 0) {
      perFile.push(fileCov);
      covered += fileCov.covered;
      total += fileCov.covered + fileCov.uncovered;
    }
  }

  return {
    computed: true,
    percent: total > 0 ? Math.round((covered / total) * 1000) / 10 : undefined,
    coveredLines: covered,
    totalLines: total,
    files: perFile,
    unmatchedFiles,
    reportFile,
  };
}
