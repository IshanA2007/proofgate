import type {
  AttestationResult,
  Finding,
  PatchCoverage,
  PinSummary,
  TestResult,
  Verdict,
  VerdictResult,
} from './types';

export const COMMENT_MARKER = '<!-- proofgate-report -->';

const VERDICT_META: Record<Verdict, { emoji: string; label: string; tagline: string }> = {
  strong: {
    emoji: '✅',
    label: 'STRONG',
    tagline: 'Tests pass, no gaming signals, attestation complete. Review on the merits.',
  },
  weak: {
    emoji: '⚠️',
    label: 'WEAK',
    tagline: 'Proof is incomplete. The burden is on the contributor to resolve the items below.',
  },
  'gaming-detected': {
    emoji: '🚨',
    label: 'GAMING DETECTED',
    tagline:
      'This PR appears to weaken its own verification. Do not trust green checks at face value.',
  },
};

export interface ReportInput {
  verdict: VerdictResult;
  tests: TestResult;
  findings: Finding[];
  attestation: AttestationResult;
  requireAttestation: boolean;
  coverage?: PatchCoverage;
  pinned?: PinSummary;
  /** True when test/coverage results were attested by an upstream CI run. */
  ciReported?: boolean;
}

const MAX_INLINE = 200;

/**
 * Base sanitizer for contributor-controlled strings (PR body, file names,
 * diff content): collapse to one line and neutralize backticks so nothing
 * can break out of a code span.
 */
function stripCode(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/`/g, "'").slice(0, MAX_INLINE);
}

/** For plain markdown contexts: also escape link/image/HTML/table syntax. */
function escapeMd(text: string): string {
  return stripCode(text).replace(/[[\]<>!|]/g, (c) => `\\${c}`);
}

/** For `code spans` inside tables: literal rendering, but pipes still split cells. */
function tableCode(text: string): string {
  return stripCode(text).replace(/\|/g, '\\|');
}

/** Collapses sorted line numbers into compact ranges: [1,2,3,7] → "1–3, 7". */
function ranges(lines: number[]): string {
  const sorted = [...lines].sort((a, b) => a - b);
  const parts: string[] = [];
  let start: number | undefined;
  let prev: number | undefined;
  for (const n of sorted) {
    if (prev !== undefined && n === prev + 1) {
      prev = n;
      continue;
    }
    if (start !== undefined) parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = prev = n;
  }
  if (start !== undefined) parts.push(start === prev ? `${start}` : `${start}–${prev}`);
  return parts.join(', ');
}

function renderCoverage(cov: PatchCoverage | undefined): string {
  const lines: string[] = ['### 📊 Patch coverage', ''];
  if (!cov) {
    lines.push(
      'Not configured — set `coverage-command` (or `coverage-file`) to require test coverage on changed lines.',
    );
    return lines.join('\n');
  }
  if (!cov.computed) {
    lines.push(`Not computed — ${escapeMd(cov.reason ?? 'no coverage report found')}.`);
    return lines.join('\n');
  }
  if (cov.percent === undefined) {
    lines.push('No measurable changed lines in this PR.');
  } else {
    lines.push(
      `**${cov.percent}%** of changed lines are covered by tests (${cov.coveredLines}/${cov.totalLines}).`,
    );
    const uncoveredFiles = (cov.files ?? []).filter((f) => f.uncovered > 0);
    if (uncoveredFiles.length > 0) {
      lines.push(
        '',
        '<details><summary>Uncovered changed lines</summary>',
        '',
        '| File | Uncovered lines |',
        '| --- | --- |',
      );
      for (const f of uncoveredFiles) {
        lines.push(`| \`${tableCode(f.file)}\` | ${ranges(f.uncoveredLines)} |`);
      }
      lines.push('', '</details>');
    }
  }
  if (cov.unmatchedFiles && cov.unmatchedFiles.length > 0) {
    lines.push(
      '',
      `⚠️ Absent from the coverage report entirely: ${cov.unmatchedFiles
        .map((f) => `\`${stripCode(f)}\``)
        .join(', ')} — likely never imported by any test.`,
    );
  }
  return lines.join('\n');
}

function renderTests(tests: TestResult, pinned?: PinSummary): string {
  const lines: string[] = ['### 🧪 Tests', ''];
  if (!tests.ran) {
    lines.push(`⏭️ **Tests not run** — ${escapeMd(tests.skippedReason ?? 'unknown reason')}`);
    return lines.join('\n');
  }
  const result = tests.passed
    ? '✅ passed'
    : `❌ failed${tests.exitCode !== undefined ? ` (exit code ${tests.exitCode})` : ''}`;
  lines.push(
    '| | |',
    '| --- | --- |',
    `| Command | \`${tableCode(tests.command ?? '?')}\` |`,
    `| Result | ${result} |`,
  );
  if (tests.durationMs !== undefined) {
    lines.push(`| Duration | ${(tests.durationMs / 1000).toFixed(0)}s |`);
  }
  if (tests.outputTail) {
    lines.push(
      '',
      '<details><summary>Test output (tail)</summary>',
      '',
      '```text',
      tests.outputTail.replace(/```/g, '` ` `'),
      '```',
      '',
      '</details>',
    );
  }
  if (pinned) {
    if (pinned.ran) {
      lines.push(
        '',
        pinned.regression
          ? "🧷 **Base-pinned run: ❌ failed** — the base branch's tests fail against this PR's code. The PR likely rewrote tests to hide a regression."
          : "🧷 Base-pinned run: ✅ passed — the base branch's tests also pass against this code.",
      );
    } else {
      lines.push('', `🧷 Base-pinned run: ⏭️ skipped — ${escapeMd(pinned.reason ?? '')}`);
    }
  }
  return lines.join('\n');
}

function renderFindings(findings: Finding[]): string {
  const lines: string[] = ['### 🔍 Gaming scan', ''];
  if (findings.length === 0) {
    lines.push('No test-gaming patterns detected.');
    return lines.join('\n');
  }
  lines.push(
    `${findings.length} suspicious change(s) found:`,
    '',
    '| Severity | Rule | Location | Evidence | Detail |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const f of findings) {
    const sev = f.severity === 'high' ? '🔴 high' : '🟡 medium';
    const loc = f.line !== undefined ? `${f.file}:${f.line}` : f.file;
    lines.push(
      `| ${sev} | ${f.rule} | \`${tableCode(loc)}\` | ${escapeMd(f.evidence)} | ${escapeMd(f.message)} |`,
    );
  }
  return lines.join('\n');
}

function renderAttestation(attestation: AttestationResult, required: boolean): string {
  const lines: string[] = ['### 📝 Contributor attestation', ''];
  if (!required) {
    lines.push("Not required by this repository's configuration.");
    return lines.join('\n');
  }
  switch (attestation.status) {
    case 'complete':
      lines.push(
        `✅ Complete${attestation.aiToolsUsed ? ` — AI tools disclosed: \`${stripCode(attestation.aiToolsUsed)}\`` : ''}`,
      );
      break;
    case 'incomplete':
      lines.push(
        '⚠️ Incomplete:',
        '',
        ...attestation.missingItems.map((item) => `- ${escapeMd(item)}`),
      );
      break;
    case 'missing':
      lines.push(
        '❌ Missing — the PR description has no "ProofGate Attestation" section.',
        '',
        "Copy the section from this project's pull request template, fill it out, and re-run the check.",
      );
      break;
  }
  return lines.join('\n');
}

/** Renders the full verdict report used for both the PR comment and the job summary. */
export function renderReport(input: ReportInput): string {
  const meta = VERDICT_META[input.verdict.verdict];
  const parts: string[] = [
    COMMENT_MARKER,
    `## 🛡️ ProofGate verdict: ${meta.emoji} ${meta.label}`,
    '',
    `> ${meta.tagline}`,
    '',
    '**Why:**',
    ...input.verdict.reasons.map((r) => `- ${escapeMd(r)}`),
    '',
    renderTests(input.tests, input.pinned),
    '',
    renderCoverage(input.coverage),
    '',
    renderFindings(input.findings),
    '',
    renderAttestation(input.attestation, input.requireAttestation),
    '',
    '---',
    ...(input.ciReported
      ? [
          '<sub>Test, coverage, and pinning results are as reported by the upstream CI run; the gaming scan and attestation were recomputed independently by ProofGate.</sub>',
        ]
      : []),
    '<sub>🛡️ ProofGate — proof-of-work for pull requests. The contributor carries the burden of proof, not the maintainer.</sub>',
  ];
  return parts.join('\n');
}
