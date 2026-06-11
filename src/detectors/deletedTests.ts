import { isTestFile, prModifiesSource } from '../classify';
import { parsePatch } from '../diff';
import type { ChangedFile, Finding } from '../types';

const TEST_DECL_PATTERNS: RegExp[] = [
  /\b(?:it|test|describe)(?:\.\w+)?\s*\(\s*['"`]/, // jest/mocha/vitest
  /\bdef test_\w+/, // pytest/unittest
  /\bfunc Test\w+\s*\(/, // go
  /#\[(?:test|tokio::test)\]/, // rust
  /^\s*(?:it|specify|scenario)\s+['"]/, // rspec
  /@Test\b/, // junit/testng
];

function isTestDecl(line: string): boolean {
  return TEST_DECL_PATTERNS.some((re) => re.test(line));
}

/**
 * Detects test files deleted outright and net removal of test cases from
 * modified test files. Severity escalates when the PR also changes source,
 * since deleting tests alongside behavior changes is the classic way to make
 * a broken change look green.
 */
export function detectDeletedTests(files: ChangedFile[]): Finding[] {
  const findings: Finding[] = [];
  const sourceChanged = prModifiesSource(files);

  for (const f of files) {
    if (!isTestFile(f.filename)) continue;

    if (f.status === 'removed') {
      findings.push({
        rule: 'deleted-tests',
        file: f.filename,
        severity: sourceChanged ? 'high' : 'medium',
        evidence: `${f.deletions} line(s) deleted`,
        message: 'Test file deleted',
      });
      continue;
    }

    const { added, removed } = parsePatch(f.patch);
    const removedDecls = removed.filter((l) => isTestDecl(l.content));
    const addedDecls = added.filter((l) => isTestDecl(l.content));
    const net = removedDecls.length - addedDecls.length;
    if (net > 0) {
      const first = removedDecls[0];
      findings.push({
        rule: 'deleted-tests',
        file: f.filename,
        line: first?.line,
        severity: net >= 3 && sourceChanged ? 'high' : 'medium',
        evidence: (first?.content ?? '').trim().slice(0, 120),
        message: `${net} test case(s) removed`,
      });
    }
  }
  return findings;
}
