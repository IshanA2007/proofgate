import * as core from '@actions/core';
import * as github from '@actions/github';
import type { GitHubClient } from './github';
import { runProofGate } from './run';
import { defaultExec, realFs } from './testRunner';
import type { FailOn } from './types';

function parseFailOn(raw: string): FailOn {
  if (raw === 'gaming' || raw === 'weak' || raw === 'never') return raw;
  core.warning(`Unknown fail-on value "${raw}", defaulting to "gaming"`);
  return 'gaming';
}

function parseBoolean(raw: string, fallback: boolean): boolean {
  const value = raw.trim().toLowerCase();
  if (['true', 'yes', '1', 'on'].includes(value)) return true;
  if (['false', 'no', '0', 'off'].includes(value)) return false;
  return fallback;
}

async function main(): Promise<void> {
  const pr = github.context.payload.pull_request;
  if (!pr) {
    core.setFailed(
      `ProofGate must run on pull_request events (got "${github.context.eventName}").`,
    );
    return;
  }

  // action.yml declares the input optional with `${{ github.token }}` as the
  // default, so an empty value here means the caller overrode it with "".
  const token = core.getInput('github-token');
  if (!token) {
    core.setFailed('github-token is empty — pass a token or omit the input to use the default.');
    return;
  }
  const octokit = github.getOctokit(token);

  const outcome = await runProofGate({
    inputs: {
      testCommand: core.getInput('test-command') || undefined,
      requireAttestation: parseBoolean(core.getInput('require-attestation'), true),
      failOn: parseFailOn(core.getInput('fail-on') || 'gaming'),
      workingDirectory: core.getInput('working-directory') || '.',
    },
    pr: {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      prNumber: pr.number,
      body: typeof pr.body === 'string' ? pr.body : null,
    },
    client: octokit as unknown as GitHubClient,
    exec: defaultExec,
    fs: realFs,
    log: { info: core.info, warning: core.warning },
  });

  core.setOutput('verdict', outcome.verdict.verdict);
  core.setOutput('tests-passed', String(outcome.tests.passed ?? false));
  core.setOutput('findings', JSON.stringify(outcome.findings));
  await core.summary.addRaw(outcome.report).write();

  if (outcome.shouldFail) {
    core.setFailed(outcome.failMessage ?? `ProofGate verdict: ${outcome.verdict.verdict}`);
  } else {
    core.info(`ProofGate verdict: ${outcome.verdict.verdict}`);
  }
}

main().catch((err: unknown) => {
  core.setFailed(
    `ProofGate crashed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
});
