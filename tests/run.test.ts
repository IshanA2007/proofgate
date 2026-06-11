import { describe, expect, it } from 'vitest';
import type { ReportBundle } from '../src/artifact';
import type { GitHubClient } from '../src/github';
import { COMMENT_MARKER } from '../src/report';
import { recomputeAndPost, runProofGate, type RunOptions } from '../src/run';
import type { ReportMeta } from '../src/types';

const COMPLETE_BODY = `
### ProofGate Attestation

AI tools used: none

- [x] I have disclosed all AI assistance used to produce this PR above
- [x] I ran the project's full test suite locally and it passes
- [x] I understand this change and can explain every line of it
`;

const CLEAN_FILES = [
  {
    filename: 'src/core.ts',
    status: 'modified',
    additions: 5,
    deletions: 2,
    patch: '@@ -1,3 +1,5 @@\n+const fixed = true;',
  },
];

const GAMING_FILES = [
  ...CLEAN_FILES,
  { filename: 'tests/core.test.ts', status: 'removed', additions: 0, deletions: 80 },
];

interface RecordedRequest {
  route: string;
  params: Record<string, unknown>;
}

function fakeClient(
  files: unknown[],
  comments: Array<{ id: number; body?: string }> = [],
  { failRequests = false } = {},
): { client: GitHubClient; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const client: GitHubClient = {
    async paginate<T>(route: string): Promise<T[]> {
      if (route.includes('/files')) return files as T[];
      if (route.includes('/comments')) return comments as T[];
      throw new Error(`unexpected paginate route: ${route}`);
    },
    async request(route: string, params: Record<string, unknown>) {
      if (failRequests) throw new Error('403 Resource not accessible by integration');
      requests.push({ route, params });
      return { data: {} };
    },
  };
  return { client, requests };
}

const baseInputs: RunOptions['inputs'] = {
  testCommand: 'make check',
  requireAttestation: true,
  requireTests: false,
  baseTestPinning: 'off',
  failOn: 'gaming',
  workingDirectory: '.',
};

function baseOptions(client: GitHubClient, overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    inputs: { ...baseInputs },
    pr: { owner: 'octo', repo: 'proj', prNumber: 7, body: COMPLETE_BODY, baseRef: 'main' },
    client,
    exec: async () => ({ exitCode: 0, output: 'ok' }),
    fs: { exists: () => false, read: () => '' },
    log: { info: () => {}, warning: () => {} },
    ...overrides,
  };
}

describe('runProofGate', () => {
  it('produces a strong verdict and posts a new comment on a clean PR', async () => {
    const { client, requests } = fakeClient(CLEAN_FILES);
    const outcome = await runProofGate(baseOptions(client));

    expect(outcome.verdict.verdict).toBe('strong');
    expect(outcome.shouldFail).toBe(false);
    expect(outcome.commentStatus).toBe('created');
    expect(outcome.report).toContain(COMMENT_MARKER);

    const post = requests.find((r) => r.route.startsWith('POST'));
    expect(post?.params['issue_number']).toBe(7);
    expect(String(post?.params['body'])).toContain('STRONG');
  });

  it('detects gaming and fails the run under fail-on: gaming', async () => {
    const { client } = fakeClient(GAMING_FILES);
    const outcome = await runProofGate(baseOptions(client));

    expect(outcome.verdict.verdict).toBe('gaming-detected');
    expect(outcome.shouldFail).toBe(true);
    expect(outcome.failMessage).toContain('gaming');
  });

  it('updates the existing sticky comment instead of stacking new ones', async () => {
    const { client, requests } = fakeClient(CLEAN_FILES, [
      { id: 11, body: 'unrelated comment' },
      { id: 42, body: `${COMMENT_MARKER}\nold report` },
    ]);
    const outcome = await runProofGate(baseOptions(client));

    expect(outcome.commentStatus).toBe('updated');
    const patch = requests.find((r) => r.route.startsWith('PATCH'));
    expect(patch?.params['comment_id']).toBe(42);
  });

  it('tolerates comment failures (fork PRs) and still returns the verdict', async () => {
    const warnings: string[] = [];
    const { client } = fakeClient(CLEAN_FILES, [], { failRequests: true });
    const outcome = await runProofGate(
      baseOptions(client, {
        log: { info: () => {}, warning: (msg) => warnings.push(msg) },
      }),
    );

    expect(outcome.verdict.verdict).toBe('strong');
    expect(outcome.commentStatus).toBe('failed');
    expect(warnings.join(' ')).toContain('fork');
  });

  it('fails weak verdicts under fail-on: weak', async () => {
    const { client } = fakeClient(CLEAN_FILES);
    const outcome = await runProofGate(
      baseOptions(client, {
        exec: async () => ({ exitCode: 1, output: '1 failing' }),
      }),
    );
    expect(outcome.verdict.verdict).toBe('weak');
    expect(outcome.shouldFail).toBe(false);

    const { client: client2 } = fakeClient(CLEAN_FILES);
    const outcome2 = await runProofGate(
      baseOptions(client2, {
        inputs: { ...baseInputs, failOn: 'weak' },
        exec: async () => ({ exitCode: 1, output: '1 failing' }),
      }),
    );
    expect(outcome2.shouldFail).toBe(true);
  });

  it('never fails under fail-on: never, even for gaming', async () => {
    const { client } = fakeClient(GAMING_FILES);
    const outcome = await runProofGate(
      baseOptions(client, { inputs: { ...baseInputs, failOn: 'never' } }),
    );
    expect(outcome.verdict.verdict).toBe('gaming-detected');
    expect(outcome.shouldFail).toBe(false);
  });

  it('falls back to the missing-tests heuristic when coverage is unavailable', async () => {
    const { client } = fakeClient(CLEAN_FILES);
    const outcome = await runProofGate(
      baseOptions(client, { inputs: { ...baseInputs, requireTests: true } }),
    );
    expect(outcome.verdict.verdict).toBe('weak');
    expect(outcome.findings.map((f) => f.rule)).toContain('missing-tests');
  });

  it('computes patch coverage from an lcov report and enforces the threshold', async () => {
    const { client } = fakeClient(CLEAN_FILES);
    const lcov = 'SF:src/core.ts\nDA:1,0\nend_of_record';
    const outcome = await runProofGate(
      baseOptions(client, {
        fs: { exists: (p) => p === './lcov.info', read: (p) => (p === './lcov.info' ? lcov : '') },
        inputs: { ...baseInputs, coverageCommand: 'make cov', patchCoverageThreshold: 50 },
      }),
    );
    expect(outcome.coverage?.percent).toBe(0);
    expect(outcome.verdict.verdict).toBe('weak');
    expect(outcome.verdict.reasons.join(' ')).toContain('Patch coverage 0%');
  });

  it('escalates to gaming-detected when the base-pinned suite fails', async () => {
    const files = [
      ...CLEAN_FILES,
      {
        filename: 'tests/core.test.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        patch: '@@ -1,2 +1,2 @@\n-old\n+new',
      },
    ];
    const { client } = fakeClient(files);
    let testRuns = 0;
    const outcome = await runProofGate(
      baseOptions(client, {
        inputs: { ...baseInputs, baseTestPinning: 'auto' },
        exec: async (cmd) => {
          if (cmd === 'make check') {
            testRuns++;
            return { exitCode: testRuns === 1 ? 0 : 1, output: '' };
          }
          return { exitCode: 0, output: '' };
        },
      }),
    );
    expect(outcome.pinned).toMatchObject({ ran: true, regression: true });
    expect(outcome.findings.map((f) => f.rule)).toContain('base-test-regression');
    expect(outcome.verdict.verdict).toBe('gaming-detected');
  });

  it('uploads the report bundle with CI-attested results', async () => {
    const { client } = fakeClient(CLEAN_FILES);
    const bundles: ReportBundle[] = [];
    await runProofGate(
      baseOptions(client, {
        uploadBundle: async (b) => {
          bundles.push(b);
        },
      }),
    );
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.meta).toMatchObject({ version: 1, prNumber: 7 });
    expect(bundles[0]?.meta.tests.passed).toBe(true);
    expect(bundles[0]?.report).toContain(COMMENT_MARKER);
  });
});

describe('recomputeAndPost', () => {
  const meta: ReportMeta = {
    version: 1,
    prNumber: 7,
    tests: { ran: true, command: 'npm test', passed: true, exitCode: 0 },
    inputs: { requireAttestation: true, requireTests: false, patchCoverageThreshold: 0 },
  };
  const log = { info: () => {}, warning: () => {} };

  it('recomputes the scan, posts the comment, and labels CI-reported results', async () => {
    const { client, requests } = fakeClient(CLEAN_FILES);
    const outcome = await recomputeAndPost({
      client,
      owner: 'octo',
      repo: 'proj',
      prNumber: 7,
      prBody: COMPLETE_BODY,
      meta,
      log,
    });
    expect(outcome.verdict.verdict).toBe('strong');
    expect(outcome.commentStatus).toBe('created');
    expect(outcome.report).toContain('recomputed independently');
    expect(requests.some((r) => r.route.startsWith('POST'))).toBe(true);
  });

  it('relays a CI-reported base-test regression as gaming-detected', async () => {
    const { client } = fakeClient(CLEAN_FILES);
    const outcome = await recomputeAndPost({
      client,
      owner: 'octo',
      repo: 'proj',
      prNumber: 7,
      prBody: COMPLETE_BODY,
      meta: { ...meta, pinned: { ran: true, regression: true, passed: false } },
      log,
    });
    expect(outcome.findings.map((f) => f.rule)).toContain('base-test-regression');
    expect(outcome.verdict.verdict).toBe('gaming-detected');
  });

  it('cannot be laundered: a gamed diff stays gaming-detected despite a forged strong meta', async () => {
    const { client } = fakeClient(GAMING_FILES);
    const outcome = await recomputeAndPost({
      client,
      owner: 'octo',
      repo: 'proj',
      prNumber: 7,
      prBody: COMPLETE_BODY,
      meta,
      log,
    });
    expect(outcome.verdict.verdict).toBe('gaming-detected');
  });
});
