import { ARTIFACT_NAME } from '../../src/artifact';
import type { GitHubClient } from '../../src/github';
import { recomputeAndPost } from '../../src/run';
import type { ReportMeta } from '../../src/types';

export interface WorkflowRunPayload {
  workflow_run: { id: number; head_sha: string; conclusion: string | null };
  repository: { name: string; owner: { login: string } };
}

export interface HandlerDeps {
  client: GitHubClient;
  payload: WorkflowRunPayload;
  /** Downloads and extracts the proofgate-report artifact. Injected for tests. */
  fetchBundle: (
    client: GitHubClient,
    owner: string,
    repo: string,
    artifactId: number,
  ) => Promise<{ meta: ReportMeta }>;
  log: { info(msg: string): void; warning(msg: string): void };
}

const CHECK_CONCLUSION: Record<string, string> = {
  strong: 'success',
  weak: 'neutral',
  'gaming-detected': 'failure',
};

/** GitHub caps check-run summaries at 65535 characters. */
const MAX_CHECK_SUMMARY = 65000;

/**
 * Reacts to any completed workflow run that produced a proofgate-report
 * artifact: resolves the PR from the run's head SHA (never from the forgeable
 * artifact), recomputes the gaming scan + attestation server-side, posts the
 * sticky comment as the App, and publishes a Check Run with the verdict.
 */
export async function handleWorkflowRunCompleted(
  deps: HandlerDeps,
): Promise<'posted' | 'skipped'> {
  const { client, payload, log } = deps;
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const run = payload.workflow_run;

  const artifacts = await client.paginate<{ id: number; name: string }>(
    'GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts',
    { owner, repo, run_id: run.id, per_page: 100 },
  );
  const artifact = artifacts.find((a) => a.name === ARTIFACT_NAME);
  if (!artifact) return 'skipped';

  const prs = await client.paginate<{ number: number; body: string | null }>(
    'GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls',
    { owner, repo, commit_sha: run.head_sha, per_page: 100 },
  );
  const pr = prs[0];
  if (!pr) {
    log.info(`No open PR found for head SHA ${run.head_sha}; nothing to post.`);
    return 'skipped';
  }

  const { meta } = await deps.fetchBundle(client, owner, repo, artifact.id);

  const outcome = await recomputeAndPost({
    client,
    owner,
    repo,
    prNumber: pr.number,
    prBody: pr.body,
    meta,
    log,
  });

  await client.request('POST /repos/{owner}/{repo}/check-runs', {
    owner,
    repo,
    name: 'ProofGate',
    head_sha: run.head_sha,
    status: 'completed',
    conclusion: CHECK_CONCLUSION[outcome.verdict.verdict] ?? 'neutral',
    output: {
      title: `ProofGate: ${outcome.verdict.verdict}`,
      summary: outcome.report.slice(0, MAX_CHECK_SUMMARY),
    },
  });
  log.info(`Posted ${outcome.verdict.verdict} verdict on PR #${pr.number}`);
  return 'posted';
}
