import { describe, expect, it } from 'vitest';
import { COMMENT_MARKER, renderReport } from '../src/report';
import type { AttestationResult, Finding, TestResult } from '../src/types';

const passingTests: TestResult = {
  ran: true,
  command: 'npm test',
  passed: true,
  exitCode: 0,
  durationMs: 12340,
  outputTail: 'Tests: 12 passed, 12 total',
};

const completeAttestation: AttestationResult = {
  status: 'complete',
  aiToolsUsed: 'none',
  missingItems: [],
};

const gamingFinding: Finding = {
  rule: 'deleted-tests',
  file: 'tests/core.test.ts',
  line: 3,
  severity: 'high',
  evidence: "it('adds | pipes', () => {",
  message: 'Test file deleted',
};

describe('renderReport', () => {
  it('always embeds the sticky-comment marker', () => {
    const report = renderReport({
      verdict: { verdict: 'strong', reasons: ['all good'] },
      tests: passingTests,
      findings: [],
      attestation: completeAttestation,
      requireAttestation: true,
    });
    expect(report).toContain(COMMENT_MARKER);
  });

  it('renders a strong verdict with test details', () => {
    const report = renderReport({
      verdict: { verdict: 'strong', reasons: ['all good'] },
      tests: passingTests,
      findings: [],
      attestation: completeAttestation,
      requireAttestation: true,
    });
    expect(report).toContain('STRONG');
    expect(report).toContain('npm test');
    expect(report).toContain('12.3s');
    expect(report).toContain('No test-gaming patterns detected');
  });

  it('renders gaming verdict with a findings table and escaped pipes', () => {
    const report = renderReport({
      verdict: { verdict: 'gaming-detected', reasons: ['1 high-severity signal'] },
      tests: passingTests,
      findings: [gamingFinding],
      attestation: completeAttestation,
      requireAttestation: true,
    });
    expect(report).toContain('GAMING DETECTED');
    expect(report).toContain('deleted-tests');
    expect(report).toContain('tests/core.test.ts:3');
    expect(report).toContain("adds \\| pipes");
  });

  it('explains how to fix a missing attestation', () => {
    const report = renderReport({
      verdict: { verdict: 'weak', reasons: ['attestation missing'] },
      tests: passingTests,
      findings: [],
      attestation: { status: 'missing', missingItems: ['No section'] },
      requireAttestation: true,
    });
    expect(report).toContain('ProofGate Attestation');
    expect(report.toLowerCase()).toContain('missing');
  });

  it('shows not-run tests with the reason', () => {
    const report = renderReport({
      verdict: { verdict: 'weak', reasons: ['tests did not run'] },
      tests: { ran: false, skippedReason: 'no test command detected' },
      findings: [],
      attestation: completeAttestation,
      requireAttestation: true,
    });
    expect(report).toContain('not run');
    expect(report).toContain('no test command detected');
  });

  it('neutralizes backticks in the AI-tools disclosure (markdown injection)', () => {
    const report = renderReport({
      verdict: { verdict: 'strong', reasons: [] },
      tests: passingTests,
      findings: [],
      attestation: {
        status: 'complete',
        aiToolsUsed: 'Copilot` ![pwn](https://evil.example/x.png)',
        missingItems: [],
      },
      requireAttestation: true,
    });
    expect(report).not.toMatch(/Copilot`/);
    expect(report).toContain("Copilot'");
  });

  it('escapes link/image syntax in verdict reasons', () => {
    const report = renderReport({
      verdict: { verdict: 'weak', reasons: ['issue in [evil](https://evil.example)'] },
      tests: passingTests,
      findings: [],
      attestation: completeAttestation,
      requireAttestation: true,
    });
    expect(report).toContain('\\[evil\\]');
  });

  it('prevents newline injection from creating fake headings', () => {
    const report = renderReport({
      verdict: { verdict: 'weak', reasons: ['x'] },
      tests: passingTests,
      findings: [],
      attestation: {
        status: 'complete',
        aiToolsUsed: 'none\n## ✅ Fake STRONG heading',
        missingItems: [],
      },
      requireAttestation: true,
    });
    expect(report).not.toMatch(/^## ✅ Fake STRONG heading/m);
  });

  it('renders patch coverage with compact uncovered-line ranges', () => {
    const report = renderReport({
      verdict: { verdict: 'weak', reasons: ['coverage'] },
      tests: passingTests,
      findings: [],
      attestation: completeAttestation,
      requireAttestation: true,
      coverage: {
        computed: true,
        percent: 40,
        coveredLines: 2,
        totalLines: 5,
        files: [{ file: 'src/x.ts', covered: 2, uncovered: 3, uncoveredLines: [4, 5, 6, 9] }],
        unmatchedFiles: ['src/never.ts'],
      },
    });
    expect(report).toContain('**40%** of changed lines');
    expect(report).toContain('4–6, 9');
    expect(report).toContain('src/never.ts');
  });

  it('shows a hint when coverage is not configured', () => {
    const report = renderReport({
      verdict: { verdict: 'strong', reasons: [] },
      tests: passingTests,
      findings: [],
      attestation: completeAttestation,
      requireAttestation: true,
    });
    expect(report).toContain('coverage-command');
  });

  it('renders the base-pinned run outcome', () => {
    const regression = renderReport({
      verdict: { verdict: 'gaming-detected', reasons: ['regression'] },
      tests: passingTests,
      findings: [],
      attestation: completeAttestation,
      requireAttestation: true,
      pinned: { ran: true, regression: true, passed: false },
    });
    expect(regression).toContain('Base-pinned run: ❌ failed');

    const skipped = renderReport({
      verdict: { verdict: 'strong', reasons: [] },
      tests: passingTests,
      findings: [],
      attestation: completeAttestation,
      requireAttestation: true,
      pinned: { ran: false, regression: false, reason: 'no existing test files were modified' },
    });
    expect(skipped).toContain('skipped — no existing test files');
  });

  it('adds the CI-attestation footnote in relayed reports', () => {
    const report = renderReport({
      verdict: { verdict: 'strong', reasons: [] },
      tests: passingTests,
      findings: [],
      attestation: completeAttestation,
      requireAttestation: true,
      ciReported: true,
    });
    expect(report).toContain('recomputed independently');
  });

  it('includes test output in a collapsible section', () => {
    const report = renderReport({
      verdict: { verdict: 'strong', reasons: [] },
      tests: passingTests,
      findings: [],
      attestation: completeAttestation,
      requireAttestation: true,
    });
    expect(report).toContain('<details>');
    expect(report).toContain('Tests: 12 passed, 12 total');
  });
});
