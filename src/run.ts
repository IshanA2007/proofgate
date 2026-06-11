import type { ReportBundle } from './artifact';
import { parseAttestation } from './attestation';
import { runBasePinnedTests, type PinMode } from './basePin';
import { computePatchCoverage, findCoverageFile, parseCoverage } from './coverage';
import { runDetectors } from './detectors';
import { detectMissingTests } from './detectors/missingTests';
import { fetchChangedFiles, upsertStickyComment, type GitHubClient, type RepoRef } from './github';
import { renderReport } from './report';
import { runTests, type ExecFn, type FsLike } from './testRunner';
import type {
  AttestationResult,
  FailOn,
  Finding,
  PatchCoverage,
  PinSummary,
  ReportMeta,
  TestResult,
  VerdictResult,
} from './types';
import { computeVerdict } from './verdict';

export interface RunInputs {
  testCommand?: string;
  /** Runs instead of the test command and should emit a coverage report. */
  coverageCommand?: string;
  coverageFile?: string;
  /** Minimum patch coverage percent; 0 disables. Default 50. */
  patchCoverageThreshold?: number;
  /** Fall back to the missing-tests heuristic when coverage is unavailable. */
  requireTests?: boolean;
  baseTestPinning?: PinMode;
  requireAttestation: boolean;
  failOn: FailOn;
  workingDirectory: string;
}

export interface RunOptions {
  inputs: RunInputs;
  pr: RepoRef & { body: string | null; baseRef?: string; headSha?: string };
  client: GitHubClient;
  exec: ExecFn;
  fs: FsLike;
  log: { info(msg: string): void; warning(msg: string): void };
  uploadBundle?: (bundle: ReportBundle) => Promise<void>;
}

export interface RunOutcome {
  verdict: VerdictResult;
  tests: TestResult;
  findings: Finding[];
  attestation: AttestationResult;
  coverage?: PatchCoverage;
  pinned: PinSummary;
  report: string;
  commentStatus: 'created' | 'updated' | 'failed';
  shouldFail: boolean;
  failMessage?: string;
}

function loadPatchCoverage(opts: RunOptions, files: Awaited<ReturnType<typeof fetchChangedFiles>>): PatchCoverage | undefined {
  const { inputs } = opts;
  const path = findCoverageFile(inputs.workingDirectory, opts.fs, inputs.coverageFile || undefined);
  if (path) {
    try {
      return computePatchCoverage(files, parseCoverage(opts.fs.read(path)), path);
    } catch (err) {
      return { computed: false, reason: `failed to parse ${path}: ${String(err)}` };
    }
  }
  if (inputs.coverageCommand || inputs.coverageFile) {
    return {
      computed: false,
      reason: inputs.coverageFile
        ? `coverage file "${inputs.coverageFile}" not found`
        : 'no coverage report found after running coverage-command',
    };
  }
  return undefined;
}

export async function runProofGate(opts: RunOptions): Promise<RunOutcome> {
  const { inputs, pr, client, log } = opts;
  const requireTests = inputs.requireTests ?? true;
  const coverageThreshold = inputs.patchCoverageThreshold ?? 50;

  log.info(`Scanning the diff of PR #${pr.prNumber}…`);
  const files = await fetchChangedFiles(client, pr);
  const findings = runDetectors(files);
  log.info(`${files.length} changed file(s), ${findings.length} finding(s)`);

  const attestation = parseAttestation(pr.body);

  log.info('Running the test suite…');
  const tests = await runTests({
    command: inputs.coverageCommand ?? inputs.testCommand,
    cwd: inputs.workingDirectory,
    exec: opts.exec,
    fs: opts.fs,
  });

  // Read the coverage report before pinning resets the worktree.
  const coverage = loadPatchCoverage(opts, files);
  if (requireTests && coverage?.computed !== true) {
    findings.push(...detectMissingTests(files));
  }

  const pin = await runBasePinnedTests({
    mode: inputs.baseTestPinning ?? 'auto',
    files,
    baseRef: pr.baseRef,
    normal: tests,
    cwd: inputs.workingDirectory,
    exec: opts.exec,
    log,
  });
  const pinned: PinSummary = {
    ran: pin.ran,
    regression: pin.regression,
    passed: pin.passed,
    reason: pin.reason,
  };
  if (pin.regression) {
    findings.push({
      rule: 'base-test-regression',
      file: pin.restoredFiles?.[0] ?? 'tests',
      severity: 'high',
      evidence: `base-pinned run exited with code ${pin.tests?.exitCode ?? '?'}`,
      message: "The base branch's tests fail against this PR's code",
    });
  }

  const verdict = computeVerdict({
    tests,
    findings,
    attestation,
    requireAttestation: inputs.requireAttestation,
    coverage,
    coverageThreshold,
  });
  const report = renderReport({
    verdict,
    tests,
    findings,
    attestation,
    requireAttestation: inputs.requireAttestation,
    coverage,
    pinned,
  });

  if (opts.uploadBundle) {
    const meta: ReportMeta = {
      version: 1,
      prNumber: pr.prNumber,
      headSha: pr.headSha,
      tests,
      coverage,
      pinned,
      inputs: {
        requireAttestation: inputs.requireAttestation,
        requireTests,
        patchCoverageThreshold: coverageThreshold,
      },
    };
    try {
      await opts.uploadBundle({ report, meta });
    } catch (err) {
      log.warning(`Could not upload the report artifact: ${String(err)}`);
    }
  }

  let commentStatus: RunOutcome['commentStatus'] = 'failed';
  try {
    commentStatus = await upsertStickyComment(client, pr, report);
  } catch (err) {
    log.warning(
      'Could not post the PR comment — on fork PRs the default token is read-only. ' +
        'Add the proofgate-comment relay workflow or install the ProofGate App to deliver ' +
        `verdicts on fork PRs. (${String(err)})`,
    );
  }

  const shouldFail =
    (inputs.failOn === 'gaming' && verdict.verdict === 'gaming-detected') ||
    (inputs.failOn === 'weak' && verdict.verdict !== 'strong');

  return {
    verdict,
    tests,
    findings,
    attestation,
    coverage,
    pinned,
    report,
    commentStatus,
    shouldFail,
    failMessage: shouldFail
      ? `ProofGate verdict: ${verdict.verdict} — ${verdict.reasons[0] ?? ''}`
      : undefined,
  };
}

export interface RecomputeOptions {
  client: GitHubClient;
  owner: string;
  repo: string;
  prNumber: number;
  prBody: string | null;
  meta: ReportMeta;
  log: { info(msg: string): void; warning(msg: string): void };
}

export interface RecomputeOutcome {
  verdict: VerdictResult;
  report: string;
  findings: Finding[];
  attestation: AttestationResult;
  commentStatus: 'created' | 'updated' | 'failed';
}

/**
 * Privileged-side verdict delivery (relay workflow or App): recompute the
 * tamper-resistant parts — diff scan and attestation — directly from the API,
 * take only test/coverage/pinning outcomes from the CI-produced meta, and
 * post the resulting report. A forged artifact can lie about test results but
 * cannot launder a gamed diff into a STRONG verdict.
 */
export async function recomputeAndPost(opts: RecomputeOptions): Promise<RecomputeOutcome> {
  const ref: RepoRef = { owner: opts.owner, repo: opts.repo, prNumber: opts.prNumber };
  const { meta } = opts;

  const files = await fetchChangedFiles(opts.client, ref);
  const findings = runDetectors(files);
  if (meta.inputs.requireTests && meta.coverage?.computed !== true) {
    findings.push(...detectMissingTests(files));
  }
  if (meta.pinned?.regression) {
    findings.push({
      rule: 'base-test-regression',
      file: 'tests',
      severity: 'high',
      evidence: 'reported by the upstream CI run',
      message: "The base branch's tests fail against this PR's code",
    });
  }

  const attestation = parseAttestation(opts.prBody);
  const verdict = computeVerdict({
    tests: meta.tests,
    findings,
    attestation,
    requireAttestation: meta.inputs.requireAttestation,
    coverage: meta.coverage,
    coverageThreshold: meta.inputs.patchCoverageThreshold,
  });
  const report = renderReport({
    verdict,
    tests: meta.tests,
    findings,
    attestation,
    requireAttestation: meta.inputs.requireAttestation,
    coverage: meta.coverage,
    pinned: meta.pinned,
    ciReported: true,
  });

  let commentStatus: RecomputeOutcome['commentStatus'] = 'failed';
  try {
    commentStatus = await upsertStickyComment(opts.client, ref, report);
  } catch (err) {
    opts.log.warning(`Could not post the PR comment: ${String(err)}`);
  }

  return { verdict, report, findings, attestation, commentStatus };
}
