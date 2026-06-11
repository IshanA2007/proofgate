import { describe, expect, it } from 'vitest';
import { parsePatch } from '../src/diff';

const SAMPLE_PATCH = `@@ -1,5 +1,4 @@
 const a = 1;
-const b = 2;
-const c = 3;
+const bc = 5;
 export { a };
@@ -20,3 +19,4 @@ function tail() {
   return 1;
+  // appended
 }`;

describe('parsePatch', () => {
  it('returns empty results for an undefined patch (binary/large files)', () => {
    expect(parsePatch(undefined)).toEqual({ added: [], removed: [] });
  });

  it('extracts added lines with new-file line numbers', () => {
    const { added } = parsePatch(SAMPLE_PATCH);
    expect(added).toEqual([
      { content: 'const bc = 5;', line: 2 },
      { content: '  // appended', line: 20 },
    ]);
  });

  it('extracts removed lines with old-file line numbers', () => {
    const { removed } = parsePatch(SAMPLE_PATCH);
    expect(removed).toEqual([
      { content: 'const b = 2;', line: 2 },
      { content: 'const c = 3;', line: 3 },
    ]);
  });

  it('handles hunk headers without a count (single-line hunks)', () => {
    const patch = `@@ -7 +7 @@\n-old\n+new`;
    expect(parsePatch(patch)).toEqual({
      added: [{ content: 'new', line: 7 }],
      removed: [{ content: 'old', line: 7 }],
    });
  });

  it('ignores file-header lines before the first hunk', () => {
    const patch = `--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new`;
    expect(parsePatch(patch)).toEqual({
      added: [{ content: 'new', line: 1 }],
      removed: [{ content: 'old', line: 1 }],
    });
  });

  it('ignores "no newline at end of file" markers', () => {
    const patch = `@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file`;
    const { added, removed } = parsePatch(patch);
    expect(added).toHaveLength(1);
    expect(removed).toHaveLength(1);
  });
});
