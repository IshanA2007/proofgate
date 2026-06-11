import { isTestFile, prModifiesSource } from '../classify';
import { parsePatch } from '../diff';
import type { ChangedFile, Finding } from '../types';

const SKIP_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(?:it|test|describe)\.skip\s*\(/, label: '.skip' },
  { re: /\b(?:it|test|describe)\.todo\s*\(/, label: '.todo placeholder' },
  { re: /\b(?:it|test|describe)\.only\s*\(/, label: '.only — silently excludes all other tests' },
  { re: /\bx(?:it|describe|test|context|specify)\s*[(\s'"]/, label: 'x-prefixed disabled test' },
  { re: /\bf(?:it|describe)\s*\(\s*['"`]/, label: 'focused test — excludes others' },
  { re: /@pytest\.mark\.skip/, label: 'pytest skip marker' },
  { re: /@unittest\.skip/, label: 'unittest skip decorator' },
  { re: /\bpytest\.skip\s*\(/, label: 'pytest.skip() call' },
  { re: /\bt\.Skip(?:f|Now)?\s*\(/, label: 'Go t.Skip' },
  { re: /#\[ignore\]/, label: 'Rust #[ignore] attribute' },
];

/**
 * Detects tests being disabled (skipped) or scoped down (.only/focused) in
 * added lines of test files. Disabling an existing test alongside source
 * changes is high severity; in new files or test-only PRs it is medium.
 */
export function detectSkippedTests(files: ChangedFile[]): Finding[] {
  const findings: Finding[] = [];
  const sourceChanged = prModifiesSource(files);

  for (const f of files) {
    if (!isTestFile(f.filename) || f.status === 'removed') continue;
    const severity = f.status !== 'added' && sourceChanged ? 'high' : 'medium';
    const { added } = parsePatch(f.patch);
    for (const line of added) {
      const hit = SKIP_PATTERNS.find((p) => p.re.test(line.content));
      if (hit) {
        findings.push({
          rule: 'skipped-tests',
          file: f.filename,
          line: line.line,
          severity,
          evidence: line.content.trim().slice(0, 120),
          message: `Disabled or narrowed test added (${hit.label})`,
        });
      }
    }
  }
  return findings;
}
