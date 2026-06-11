import * as core from '@actions/core';
import * as github from '@actions/github';
import { readReportBundle, uploadReportBundle } from './artifact';
import type { PinMode } from './basePin';
import type { GitHubClient } from './github';
import { recomputeAndPost, runProofGate } from './run';
import { defaultExec, realFs } from './testRunner';
import type { FailOn } from './types';

function parseFailOn(raw: string): FailOn {
  if (raw === 'gaming' || raw === 'weak' || raw === 'never') return raw;
  core.warning(`Unknown fail-on value "${raw}", defaulting to "gaming"`);
  return 'gaming';
}

function parsePinMode(raw: string): PinMode {
  if (raw === 'auto' || raw === 'always' || raw === 'off') return raw;
  if (raw) core.warning(`Unknown base-test-pinning value "${raw}", defaulting to "auto"`);
  return 'auto';
}

function parseBoolean(raw: string, fallback: boolean): boolean {
  const value = raw.trim().toLowerCase();
  if (['true', 'yes', '1', 'on'].includes(value)) return true;
  if (['false', 'no', '0', 'off'].includes(value)) return false;
  return fallback;
}

function parseThreshold(raw: string): number {
  if (raw.trim() === '') return 50;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    if (raw) core.warning(`Invalid patch-coverage-threshold "${raw}", defaulting to 50`);
    return 50;
  }
  return n;
}

function getClient(): GitHubClient | undefined {
  // action.yml declares the input optional with `${{ github.token }}` as the
  // default, so an empty value here means the caller overrode it with "".
  const token = core.getInput('github-token');
  if (!token) {
    core.setFailed('github-token is empty — pass a token or omit the input to use the default.');
    return undefined;
  }
  return github.getOctokit(token) as unknown as GitHubClient;
}

async function runCheckMode(client: GitHubClient): Promise<void> {
  const pr = github.context.payload.pull_request;
  if (!pr) {
    core.setFailed(
      `ProofGate must run on pull_request events (got "${github.context.eventName}").`,
    );
    return;
  }

  const outcome = await runProofGate({
    inputs: {
      testCommand: core.getInput('test-command') || undefined,
      coverageCommand: core.getInput('coverage-command') || undefined,
      coverageFile: core.getInput('coverage-file') || undefined,
      patchCoverageThreshold: parseThreshold(core.getInput('patch-coverage-threshold')),
      requireTests: parseBoolean(core.getInput('require-tests'), true),
      baseTestPinning: parsePinMode(core.getInput('base-test-pinning')),
      requireAttestation: parseBoolean(core.getInput('require-attestation'), true),
      failOn: parseFailOn(core.getInput('fail-on') || 'gaming'),
      workingDirectory: core.getInput('working-directory') || '.',
    },
    pr: {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      prNumber: pr.number,
      body: typeof pr.body === 'string' ? pr.body : null,
      baseRef: (pr['base'] as { ref?: string } | undefined)?.ref,
      headSha: (pr['head'] as { sha?: string } | undefined)?.sha,
    },
    client,
    exec: defaultExec,
    fs: realFs,
    log: { info: core.info, warning: core.warning },
    uploadBundle: (bundle) => uploadReportBundle(bundle),
  });

  core.setOutput('verdict', outcome.verdict.verdict);
  core.setOutput('tests-passed', String(outcome.tests.passed ?? false));
  core.setOutput('findings', JSON.stringify(outcome.findings));
  core.setOutput('patch-coverage', outcome.coverage?.percent?.toString() ?? '');
  await core.summary.addRaw(outcome.report).write();

  if (outcome.shouldFail) {
    core.setFailed(outcome.failMessage ?? `ProofGate verdict: ${outcome.verdict.verdict}`);
  } else {
    core.info(`ProofGate verdict: ${outcome.verdict.verdict}`);
  }
}

interface PullSummary {
  number: number;
  body: string | null;
}

async function runPostMode(client: GitHubClient): Promise<void> {
  const { owner, repo } = github.context.repo;
  const dir = core.getInput('report-path') || 'proofgate-report';
  const { meta } = readReportBundle(dir, realFs);

  // Resolve the PR from the triggering workflow run's head SHA rather than
  // trusting the (forgeable) meta.json to name a PR.
  let pr: PullSummary | undefined;
  const workflowRun = github.context.payload['workflow_run'] as
    | { head_sha?: string }
    | undefined;
  if (workflowRun?.head_sha) {
    const prs = await client.paginate<PullSummary>(
      'GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls',
      { owner, repo, commit_sha: workflowRun.head_sha, per_page: 100 },
    );
    pr = prs[0];
    if (!pr) {
      core.info(`No open PR found for head SHA ${workflowRun.head_sha}; nothing to post.`);
      return;
    }
  } else {
    core.warning(
      'No workflow_run head SHA in the event payload — falling back to the PR number from ' +
        'the artifact, which the upstream job could have forged. Prefer running this in a ' +
        'workflow_run-triggered relay.',
    );
    const res = await client.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner,
      repo,
      pull_number: meta.prNumber,
    });
    pr = res.data as PullSummary;
  }

  const outcome = await recomputeAndPost({
    client,
    owner,
    repo,
    prNumber: pr.number,
    prBody: pr.body,
    meta,
    log: { info: core.info, warning: core.warning },
  });

  core.setOutput('verdict', outcome.verdict.verdict);
  await core.summary.addRaw(outcome.report).write();
  core.info(`ProofGate verdict relayed to PR #${pr.number}: ${outcome.verdict.verdict}`);
}

async function main(): Promise<void> {
  const client = getClient();
  if (!client) return;
  const mode = core.getInput('mode') || 'check';
  if (mode === 'post') {
    await runPostMode(client);
  } else {
    if (mode !== 'check') core.warning(`Unknown mode "${mode}", running in check mode`);
    await runCheckMode(client);
  }
}

main().catch((err: unknown) => {
  core.setFailed(
    `ProofGate crashed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
});
