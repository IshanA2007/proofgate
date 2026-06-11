import { describe, expect, it } from 'vitest';
import { handleWorkflowRunCompleted, type WorkflowRunPayload } from '../../app/src/handler';
import type { GitHubClient } from '../../src/github';
import type { ReportMeta } from '../../src/types';

const PAYLOAD: WorkflowRunPayload = {
  workflow_run: { id: 99, head_sha: 'abc123', conclusion: 'success' },
  repository: { name: 'proj', owner: { login: 'octo' } },
};

const META: ReportMeta = {
  version: 1,
  prNumber: 7,
  tests: { ran: true, command: 'npm test', passed: true, exitCode: 0 },
  inputs: { requireAttestation: false, requireTests: false, patchCoverageThreshold: 0 },
};

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

function fakeClient(opts: {
  artifacts?: Array<{ id: number; name: string }>;
  prs?: Array<{ number: number; body: string | null }>;
  files?: unknown[];
}): { client: GitHubClient; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const client: GitHubClient = {
    async paginate<T>(route: string): Promise<T[]> {
      if (route.includes('/artifacts')) return (opts.artifacts ?? []) as T[];
      if (route.includes('/commits/')) return (opts.prs ?? []) as T[];
      if (route.includes('/files')) return (opts.files ?? []) as T[];
      if (route.includes('/comments')) return [] as T[];
      throw new Error(`unexpected paginate route: ${route}`);
    },
    async request(route: string, params: Record<string, unknown>) {
      requests.push({ route, params });
      return { data: {} };
    },
  };
  return { client, requests };
}

const deps = {
  fetchBundle: async () => ({ meta: META }),
  log: { info: () => {}, warning: () => {} },
};

describe('handleWorkflowRunCompleted', () => {
  it('ignores workflow runs without a proofgate-report artifact', async () => {
    const { client, requests } = fakeClient({ artifacts: [{ id: 1, name: 'other' }] });
    const result = await handleWorkflowRunCompleted({ client, payload: PAYLOAD, ...deps });
    expect(result).toBe('skipped');
    expect(requests).toEqual([]);
  });

  it('skips when no open PR matches the head SHA', async () => {
    const { client, requests } = fakeClient({
      artifacts: [{ id: 1, name: 'proofgate-report' }],
      prs: [],
    });
    const result = await handleWorkflowRunCompleted({ client, payload: PAYLOAD, ...deps });
    expect(result).toBe('skipped');
    expect(requests).toEqual([]);
  });

  it('posts the comment and a success check run for a clean PR', async () => {
    const { client, requests } = fakeClient({
      artifacts: [{ id: 1, name: 'proofgate-report' }],
      prs: [{ number: 7, body: null }],
      files: CLEAN_FILES,
    });
    const result = await handleWorkflowRunCompleted({ client, payload: PAYLOAD, ...deps });
    expect(result).toBe('posted');

    const comment = requests.find((r) => r.route.includes('/comments'));
    expect(comment?.params['issue_number']).toBe(7);

    const check = requests.find((r) => r.route.includes('/check-runs'));
    expect(check?.params['head_sha']).toBe('abc123');
    expect(check?.params['conclusion']).toBe('success');
  });

  it('publishes a failure check run when the recomputed scan detects gaming', async () => {
    const { client, requests } = fakeClient({
      artifacts: [{ id: 1, name: 'proofgate-report' }],
      prs: [{ number: 7, body: null }],
      files: GAMING_FILES,
    });
    await handleWorkflowRunCompleted({ client, payload: PAYLOAD, ...deps });
    const check = requests.find((r) => r.route.includes('/check-runs'));
    expect(check?.params['conclusion']).toBe('failure');
    expect(String((check?.params['output'] as { title: string }).title)).toContain(
      'gaming-detected',
    );
  });
});
