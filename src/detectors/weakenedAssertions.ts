import { isTestFile, prModifiesSource } from '../classify';
import { parsePatch } from '../diff';
import type { ChangedFile, Finding } from '../types';

const ASSERTION_PATTERNS: RegExp[] = [
  /\bexpect\s*\(/, // jest/vitest/chai
  /^\s*assert\s+\S/, // python assert statement
  /\bassert\w*\s*\(/, // assert(), assertEqual(), assertTrue()
  /\b(?:assert|require)\.\w+\s*\(/, // testify, chai, node:assert
  /\.should[.(]/, // chai should
  /\b(?:EXPECT|ASSERT)_\w+\s*\(/, // gtest
  /\bassert(?:_eq|_ne|_matches)?!\s*\(/, // rust
];

function isAssertion(content: string): boolean {
  return ASSERTION_PATTERNS.some((re) => re.test(content));
}

const TRIVIAL_PATTERNS: RegExp[] = [
  // expect(x).toBe(x), expect(true).toBe(true), expect(1).toEqual(1)
  /\bexpect\s*\(\s*([\w'"]+)\s*\)\s*\.to(?:Be|Equal|StrictEqual)\s*\(\s*\1\s*\)/,
  /\bexpect\s*\(\s*true\s*\)\s*\.toBeTruthy/,
  /\bassert\s*\(\s*true\s*\)/i,
  /^\s*assert\s+True\s*(?:#.*)?$/,
  /\bassertTrue\s*\(\s*(?:true|True|1)\s*\)/,
  /\bassert!\s*\(\s*true\s*\)/,
  /\bEXPECT_TRUE\s*\(\s*true\s*\)/,
];

/**
 * Detects assertions being hollowed out: a net drop in assertion lines in an
 * existing test file, or always-true assertions being added so a test exists
 * in name only.
 */
export function detectWeakenedAssertions(files: ChangedFile[]): Finding[] {
  const findings: Finding[] = [];
  const sourceChanged = prModifiesSource(files);

  for (const f of files) {
    if (!isTestFile(f.filename) || f.status === 'removed') continue;
    const { added, removed } = parsePatch(f.patch);

    for (const line of added) {
      if (TRIVIAL_PATTERNS.some((re) => re.test(line.content))) {
        findings.push({
          rule: 'trivial-assertion',
          file: f.filename,
          line: line.line,
          severity: 'high',
          evidence: line.content.trim().slice(0, 120),
          message: 'Trivial always-true assertion added',
        });
      }
    }

    // Net-drop accounting only makes sense for pre-existing test files.
    if (f.status === 'added') continue;
    const removedCount = removed.filter((l) => isAssertion(l.content)).length;
    const addedCount = added.filter((l) => isAssertion(l.content)).length;
    const net = removedCount - addedCount;
    if (net > 0) {
      findings.push({
        rule: 'weakened-assertions',
        file: f.filename,
        severity: net >= 5 && sourceChanged ? 'high' : 'medium',
        evidence: `${removedCount} assertion line(s) removed, ${addedCount} added`,
        message: `Net ${net} assertion(s) removed`,
      });
    }
  }
  return findings;
}
