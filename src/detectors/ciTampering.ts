import { isCiFile, isTestConfigFile } from '../classify';
import { parsePatch, type DiffLine } from '../diff';
import type { ChangedFile, Finding, Severity } from '../types';

const TEST_RUN_LINE = /^\s*(?:-\s+)?run\s*:.*\b(?:test|lint|coverage|check|ci)\b/i;
const CONTINUE_ON_ERROR = /continue-on-error\s*:\s*true/;
const IF_FALSE = /\bif\s*:\s*['"]?false\b/;
const TEST_SCRIPT_KEY = /"(?:test|test:[\w:-]+)"\s*:/;
const THRESHOLD_RE =
  /\b(fail[_-]under|cov-fail-under|statements|branches|functions|lines|target|min(?:imum)?[_-]coverage)\b\s*[:=]\s*['"]?(\d+(?:\.\d+)?)/i;

function thresholds(lines: DiffLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const l of lines) {
    const m = THRESHOLD_RE.exec(l.content);
    if (m) map.set(m[1]!.toLowerCase(), Number(m[2]));
  }
  return map;
}

function isNeuteredScript(line: string): boolean {
  const m = /"(?:test|test:[\w:-]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(line);
  if (!m) return false;
  const value = (m[1] ?? '').trim();
  return value === '' || value === ':' || /^(?:echo\b|true$|exit 0)/.test(value);
}

function finding(
  rule: string,
  file: string,
  severity: Severity,
  evidence: string,
  message: string,
  line?: number,
): Finding {
  return { rule, file, severity, evidence: evidence.trim().slice(0, 120), message, line };
}

/**
 * Detects changes that weaken the verification machinery itself: CI workflow
 * edits, deleted/neutered test steps, lowered coverage thresholds, and
 * tampered npm test scripts.
 */
export function detectCiTampering(files: ChangedFile[]): Finding[] {
  const findings: Finding[] = [];

  for (const f of files) {
    const ci = isCiFile(f.filename);
    const cfg = isTestConfigFile(f.filename);
    const pkg = /(^|\/)package\.json$/.test(f.filename);
    if (!ci && !cfg && !pkg) continue;
    if (f.status === 'added') continue;

    const fileFindings: Finding[] = [];
    const { added, removed } = parsePatch(f.patch);

    if (ci) {
      if (f.status === 'removed') {
        fileFindings.push(
          finding(
            'ci-tampering',
            f.filename,
            'high',
            `${f.deletions} line(s) deleted`,
            'CI workflow/config deleted',
          ),
        );
      }
      for (const l of removed) {
        if (TEST_RUN_LINE.test(l.content)) {
          fileFindings.push(
            finding(
              'ci-tampering',
              f.filename,
              'high',
              l.content,
              'Test/lint/coverage step removed from CI',
              l.line,
            ),
          );
        }
      }
      for (const l of added) {
        if (CONTINUE_ON_ERROR.test(l.content)) {
          fileFindings.push(
            finding(
              'ci-tampering',
              f.filename,
              'high',
              l.content,
              '`continue-on-error: true` added to CI',
              l.line,
            ),
          );
        }
        if (IF_FALSE.test(l.content)) {
          fileFindings.push(
            finding(
              'ci-tampering',
              f.filename,
              'high',
              l.content,
              'CI step/job disabled with `if: false`',
              l.line,
            ),
          );
        }
      }
    }

    const before = thresholds(removed);
    const after = thresholds(added);
    for (const [key, prev] of before) {
      const next = after.get(key);
      if (next !== undefined && next < prev) {
        fileFindings.push(
          finding(
            'coverage-lowered',
            f.filename,
            'high',
            `${key}: ${prev} → ${next}`,
            'Coverage/quality threshold lowered',
          ),
        );
      }
    }

    if (pkg) {
      const removedScript = removed.find((l) => TEST_SCRIPT_KEY.test(l.content));
      const addedScript = added.find((l) => TEST_SCRIPT_KEY.test(l.content));
      if (removedScript && addedScript && isNeuteredScript(addedScript.content)) {
        fileFindings.push(
          finding(
            'test-script-neutered',
            f.filename,
            'high',
            addedScript.content,
            'npm test script replaced with a no-op',
            addedScript.line,
          ),
        );
      } else if (removedScript && !addedScript) {
        fileFindings.push(
          finding(
            'test-script-removed',
            f.filename,
            'high',
            removedScript.content,
            'npm test script deleted',
            removedScript.line,
          ),
        );
      } else if (removedScript && addedScript) {
        fileFindings.push(
          finding(
            'test-script-modified',
            f.filename,
            'medium',
            `${removedScript.content.trim()} → ${addedScript.content.trim()}`,
            'npm test script modified — verify it still runs the suite',
            addedScript.line,
          ),
        );
      }
    }

    // A CI/test-config edit with no specific high signal still warrants eyes.
    if (fileFindings.length === 0 && (ci || cfg)) {
      fileFindings.push(
        finding(
          'ci-tampering',
          f.filename,
          'medium',
          `+${f.additions}/−${f.deletions}`,
          ci ? 'CI configuration modified' : 'Test configuration modified',
        ),
      );
    }

    findings.push(...fileFindings);
  }
  return findings;
}
