export interface DiffLine {
  /** Line content without the leading +/- marker. */
  content: string;
  /** Line number in the new file (added lines) or old file (removed lines). */
  line: number;
}

export interface ParsedPatch {
  added: DiffLine[];
  removed: DiffLine[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parses the unified-diff `patch` string returned by the GitHub
 * pulls.listFiles API into added/removed lines with line numbers.
 */
export function parsePatch(patch: string | undefined): ParsedPatch {
  const added: DiffLine[] = [];
  const removed: DiffLine[] = [];
  if (!patch) return { added, removed };

  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of patch.split('\n')) {
    const hunk = HUNK_HEADER.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    // Tolerate "--- a/file" style headers before the first hunk.
    if (!inHunk) continue;
    if (raw.startsWith('+')) {
      added.push({ content: raw.slice(1), line: newLine });
      newLine++;
    } else if (raw.startsWith('-')) {
      removed.push({ content: raw.slice(1), line: oldLine });
      oldLine++;
    } else if (raw.startsWith('\\')) {
      // "\ No newline at end of file" — not a content line.
    } else {
      oldLine++;
      newLine++;
    }
  }
  return { added, removed };
}
