import type { AttestationResult, Finding, TestResult, VerdictResult } from './types';

export interface VerdictInput {
  tests: TestResult;
  findings: Finding[];
  attestation: AttestationResult;
  requireAttestation: boolean;
}

const MAX_DETAILED_REASONS = 5;

/**
 * Collapses all signals into one verdict:
 * - gaming-detected: any high-severity finding, regardless of test results —
 *   green checks mean nothing if the PR weakened the checks themselves.
 * - weak: failing/unrunnable tests, missing/incomplete attestation, or
 *   medium-severity findings that need human eyes.
 * - strong: everything verified.
 */
export function computeVerdict(input: VerdictInput): VerdictResult {
  const reasons: string[] = [];
  const high = input.findings.filter((f) => f.severity === 'high');
  const medium = input.findings.filter((f) => f.severity === 'medium');

  if (high.length > 0) {
    reasons.push(`${high.length} high-severity gaming signal(s) detected`);
    for (const f of high.slice(0, MAX_DETAILED_REASONS)) {
      reasons.push(`${f.rule}: ${f.message} (${f.file})`);
    }
    return { verdict: 'gaming-detected', reasons };
  }

  let weak = false;
  if (!input.tests.ran) {
    weak = true;
    reasons.push(`Tests did not run: ${input.tests.skippedReason ?? 'unknown reason'}`);
  } else if (input.tests.passed === false) {
    weak = true;
    reasons.push(
      `Test suite failed${input.tests.exitCode !== undefined ? ` (exit code ${input.tests.exitCode})` : ''}`,
    );
  }

  if (input.requireAttestation && input.attestation.status !== 'complete') {
    weak = true;
    reasons.push(
      input.attestation.status === 'missing'
        ? 'Contributor attestation is missing from the PR description'
        : `Contributor attestation is incomplete: ${input.attestation.missingItems.join('; ')}`,
    );
  }

  if (medium.length > 0) {
    weak = true;
    reasons.push(`${medium.length} suspicious change(s) need human review`);
  }

  if (weak) return { verdict: 'weak', reasons };

  return {
    verdict: 'strong',
    reasons: [
      'Test suite passed in a clean environment',
      ...(input.requireAttestation ? ['Contributor attestation complete'] : []),
      'No test-gaming signals found',
    ],
  };
}
