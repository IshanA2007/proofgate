export type Severity = 'medium' | 'high';

export interface Finding {
  /** Detector id, e.g. "deleted-tests". */
  rule: string;
  file: string;
  line?: number;
  /** Short excerpt from the diff that triggered the finding. */
  evidence: string;
  severity: Severity;
  /** Human-readable description of what was detected. */
  message: string;
}

/** A changed file as reported by the GitHub pulls.listFiles API. */
export interface ChangedFile {
  filename: string;
  status:
    | 'added'
    | 'removed'
    | 'modified'
    | 'renamed'
    | 'copied'
    | 'changed'
    | 'unchanged';
  additions: number;
  deletions: number;
  /** Unified diff hunks. Absent for binary or very large files. */
  patch?: string;
  previousFilename?: string;
}

export interface TestResult {
  ran: boolean;
  command?: string;
  passed?: boolean;
  exitCode?: number;
  durationMs?: number;
  /** Last portion of combined stdout/stderr. */
  outputTail?: string;
  /** Why tests did not run (e.g. no command detected). */
  skippedReason?: string;
}

export type AttestationStatus = 'complete' | 'incomplete' | 'missing';

export interface AttestationResult {
  status: AttestationStatus;
  /** Contents of the "AI tools used:" line, if present. */
  aiToolsUsed?: string;
  /** What is missing or unchecked, for incomplete/missing states. */
  missingItems: string[];
}

export interface FilePatchCoverage {
  file: string;
  covered: number;
  uncovered: number;
  uncoveredLines: number[];
}

export interface PatchCoverage {
  computed: boolean;
  /** Why coverage was not computed. */
  reason?: string;
  /** 0–100; undefined when there are no measurable changed lines. */
  percent?: number;
  coveredLines?: number;
  totalLines?: number;
  files?: FilePatchCoverage[];
  /** Source files with added lines that never appear in the coverage report. */
  unmatchedFiles?: string[];
  reportFile?: string;
}

/** Outcome of the base-branch pinned test run, summarized for reports. */
export interface PinSummary {
  ran: boolean;
  regression: boolean;
  passed?: boolean;
  reason?: string;
}

export type Verdict = 'strong' | 'weak' | 'gaming-detected';

export interface VerdictResult {
  verdict: Verdict;
  reasons: string[];
}

export type FailOn = 'gaming' | 'weak' | 'never';

/**
 * CI-attested results carried from the check run to the relay/App via the
 * report artifact. Everything in here is forgeable by code running in the PR
 * job, so consumers recompute the diff scan and attestation themselves and
 * only trust this for test/coverage/pinning outcomes (clearly labeled).
 */
export interface ReportMeta {
  version: 1;
  prNumber: number;
  headSha?: string;
  tests: TestResult;
  coverage?: PatchCoverage;
  pinned?: PinSummary;
  inputs: {
    requireAttestation: boolean;
    requireTests: boolean;
    patchCoverageThreshold: number;
  };
}
