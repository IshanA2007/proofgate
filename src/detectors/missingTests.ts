import { isSourceFile, isTestFile } from '../classify';
import type { ChangedFile, Finding } from '../types';

/**
 * Cheap fallback heuristic used when patch coverage is unavailable: source
 * changed but no test file was added or modified. Medium severity — plenty of
 * legitimate PRs (refactors, config) trip this, so it only demands human eyes.
 */
export function detectMissingTests(files: ChangedFile[]): Finding[] {
  const sourceFiles = files.filter((f) => isSourceFile(f.filename) && f.status !== 'removed');
  const touchesTests = files.some((f) => isTestFile(f.filename));
  if (sourceFiles.length === 0 || touchesTests) return [];
  return [
    {
      rule: 'missing-tests',
      file: sourceFiles[0]!.filename,
      severity: 'medium',
      evidence: `${sourceFiles.length} source file(s) changed, 0 test files touched`,
      message: 'Source changed without adding or updating any tests',
    },
  ];
}
