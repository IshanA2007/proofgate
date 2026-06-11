import { parseAttestation } from './attestation';
import { runDetectors } from './detectors';
import { fetchChangedFiles, upsertStickyComment, type GitHubClient, type RepoRef } from './github';
import { renderReport } from './report';
import { runTests, type ExecFn, type FsLike } from './testRunner';
import type { AttestationResult, FailOn, Finding, TestResult, VerdictResult } from './types';
import { computeVerdict } from './verdict';

export interface RunInputs {
  testCommand?: string;
  requireAttestation: boolean;
  failOn: FailOn;
  workingDirectory: string;
}

export interface RunOptions {
  inputs: RunInputs;
  pr: RepoRef & { body: string | null };
  client: GitHubClient;
  exec: ExecFn;
  fs: FsLike;
  log: { info(msg: string): void; warning(msg: string): void };
}

export interface RunOutcome {
  verdict: VerdictResult;
  tests: TestResult;
  findings: Finding[];
  attestation: AttestationResult;
  report: string;
  commentStatus: 'created' | 'updated' | 'failed';
  shouldFail: boolean;
  failMessage?: string;
}

export async function runProofGate(opts: RunOptions): Promise<RunOutcome> {
  const { inputs, pr, client, log } = opts;

  log.info(`Scanning the diff of PR #${pr.prNumber}…`);
  const files = await fetchChangedFiles(client, pr);
  const findings = runDetectors(files);
  log.info(`${files.length} changed file(s), ${findings.length} finding(s)`);

  const attestation = parseAttestation(pr.body);

  log.info('Running the test suite…');
  const tests = await runTests({
    command: inputs.testCommand,
    cwd: inputs.workingDirectory,
    exec: opts.exec,
    fs: opts.fs,
  });

  const verdict = computeVerdict({
    tests,
    findings,
    attestation,
    requireAttestation: inputs.requireAttestation,
  });
  const report = renderReport({
    verdict,
    tests,
    findings,
    attestation,
    requireAttestation: inputs.requireAttestation,
  });

  let commentStatus: RunOutcome['commentStatus'] = 'failed';
  try {
    commentStatus = await upsertStickyComment(client, pr, report);
  } catch (err) {
    log.warning(
      'Could not post the PR comment — on fork PRs the default token is read-only. ' +
        `The verdict is still in the job summary and outputs. (${String(err)})`,
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
    report,
    commentStatus,
    shouldFail,
    failMessage: shouldFail
      ? `ProofGate verdict: ${verdict.verdict} — ${verdict.reasons[0] ?? ''}`
      : undefined,
  };
}
