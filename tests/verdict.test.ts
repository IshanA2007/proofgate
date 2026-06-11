import { describe, expect, it } from 'vitest';
import { computeVerdict } from '../src/verdict';
import type { AttestationResult, Finding, TestResult } from '../src/types';

const passingTests: TestResult = { ran: true, command: 'npm test', passed: true, exitCode: 0 };
const failingTests: TestResult = { ran: true, command: 'npm test', passed: false, exitCode: 1 };
const noTests: TestResult = { ran: false, skippedReason: 'no test command detected' };

const completeAttestation: AttestationResult = { status: 'complete', missingItems: [] };
const missingAttestation: AttestationResult = {
  status: 'missing',
  missingItems: ['No "ProofGate Attestation" section in the PR description'],
};

function finding(severity: 'high' | 'medium'): Finding {
  return {
    rule: 'deleted-tests',
    file: 'tests/x.test.ts',
    severity,
    evidence: 'evidence',
    message: 'Test file deleted',
  };
}

describe('computeVerdict', () => {
  it('returns strong when tests pass, no findings, attestation complete', () => {
    const result = computeVerdict({
      tests: passingTests,
      findings: [],
      attestation: completeAttestation,
      requireAttestation: true,
    });
    expect(result.verdict).toBe('strong');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('returns gaming-detected for any high-severity finding, even if all else is green', () => {
    const result = computeVerdict({
      tests: passingTests,
      findings: [finding('high')],
      attestation: completeAttestation,
      requireAttestation: true,
    });
    expect(result.verdict).toBe('gaming-detected');
    expect(result.reasons.join(' ')).toContain('deleted-tests');
  });

  it('returns weak when tests fail', () => {
    const result = computeVerdict({
      tests: failingTests,
      findings: [],
      attestation: completeAttestation,
      requireAttestation: true,
    });
    expect(result.verdict).toBe('weak');
    expect(result.reasons.join(' ')).toContain('failed');
  });

  it('returns weak when tests could not run', () => {
    const result = computeVerdict({
      tests: noTests,
      findings: [],
      attestation: completeAttestation,
      requireAttestation: true,
    });
    expect(result.verdict).toBe('weak');
    expect(result.reasons.join(' ')).toContain('no test command detected');
  });

  it('returns weak when attestation is required but missing', () => {
    const result = computeVerdict({
      tests: passingTests,
      findings: [],
      attestation: missingAttestation,
      requireAttestation: true,
    });
    expect(result.verdict).toBe('weak');
    expect(result.reasons.join(' ')).toContain('attestation');
  });

  it('ignores attestation when not required', () => {
    const result = computeVerdict({
      tests: passingTests,
      findings: [],
      attestation: missingAttestation,
      requireAttestation: false,
    });
    expect(result.verdict).toBe('strong');
  });

  it('returns weak for medium findings only', () => {
    const result = computeVerdict({
      tests: passingTests,
      findings: [finding('medium')],
      attestation: completeAttestation,
      requireAttestation: true,
    });
    expect(result.verdict).toBe('weak');
    expect(result.reasons.join(' ')).toContain('human review');
  });

  it('accumulates multiple weak reasons', () => {
    const result = computeVerdict({
      tests: failingTests,
      findings: [finding('medium')],
      attestation: missingAttestation,
      requireAttestation: true,
    });
    expect(result.verdict).toBe('weak');
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
