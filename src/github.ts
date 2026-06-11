import { COMMENT_MARKER } from './report';
import type { ChangedFile } from './types';

/**
 * The minimal structural slice of Octokit that ProofGate uses, so the GitHub
 * layer can be exercised with plain fakes in tests.
 */
export interface GitHubClient {
  paginate<T = unknown>(route: string, params: Record<string, unknown>): Promise<T[]>;
  request(route: string, params: Record<string, unknown>): Promise<{ data: unknown }>;
}

export interface RepoRef {
  owner: string;
  repo: string;
  prNumber: number;
}

export async function fetchChangedFiles(
  client: GitHubClient,
  ref: RepoRef,
): Promise<ChangedFile[]> {
  const files = await client.paginate<Record<string, unknown>>(
    'GET /repos/{owner}/{repo}/pulls/{pull_number}/files',
    { owner: ref.owner, repo: ref.repo, pull_number: ref.prNumber, per_page: 100 },
  );
  return files.map((f) => ({
    filename: String(f.filename),
    status: f.status as ChangedFile['status'],
    additions: Number(f.additions ?? 0),
    deletions: Number(f.deletions ?? 0),
    patch: typeof f.patch === 'string' ? f.patch : undefined,
    previousFilename: typeof f.previous_filename === 'string' ? f.previous_filename : undefined,
  }));
}

/**
 * Creates or updates the single ProofGate comment on the PR, identified by
 * the marker embedded in every report.
 */
export async function upsertStickyComment(
  client: GitHubClient,
  ref: RepoRef,
  body: string,
): Promise<'created' | 'updated'> {
  const comments = await client.paginate<{ id: number; body?: string }>(
    'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
    { owner: ref.owner, repo: ref.repo, issue_number: ref.prNumber, per_page: 100 },
  );
  const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));
  if (existing) {
    await client.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
      owner: ref.owner,
      repo: ref.repo,
      comment_id: existing.id,
      body,
    });
    return 'updated';
  }
  await client.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.prNumber,
    body,
  });
  return 'created';
}
