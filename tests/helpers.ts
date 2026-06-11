import type { ChangedFile } from '../src/types';

/** A plain source-code change, used to simulate PRs that modify behavior. */
export const srcChange: ChangedFile = {
  filename: 'src/core.ts',
  status: 'modified',
  additions: 5,
  deletions: 2,
  patch: '@@ -1,3 +1,5 @@\n+const fixed = true;',
};

/** Wraps diff body lines (each starting with +, -, or space) in a hunk header. */
export function patchOf(...lines: string[]): string {
  return ['@@ -1,40 +1,40 @@', ...lines].join('\n');
}

export function changedFile(
  filename: string,
  patch: string | undefined,
  status: ChangedFile['status'] = 'modified',
): ChangedFile {
  return { filename, status, additions: 1, deletions: 1, patch };
}
