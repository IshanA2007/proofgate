import AdmZip from 'adm-zip';
import type { GitHubClient } from '../../src/github';
import type { ReportMeta } from '../../src/types';

const MAX_META_BYTES = 1024 * 1024;

/** Downloads the proofgate-report artifact zip and extracts the meta payload. */
export async function fetchBundle(
  client: GitHubClient,
  owner: string,
  repo: string,
  artifactId: number,
): Promise<{ meta: ReportMeta }> {
  const res = await client.request(
    'GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}',
    { owner, repo, artifact_id: artifactId, archive_format: 'zip' },
  );
  const zip = new AdmZip(Buffer.from(res.data as ArrayBuffer));
  const metaEntry = zip.getEntry('meta.json');
  if (!metaEntry) throw new Error('proofgate-report artifact has no meta.json');
  // The zip comes from PR-controlled CI; bound memory before extracting.
  if (metaEntry.header.size > MAX_META_BYTES) {
    throw new Error(`meta.json is too large (${metaEntry.header.size} bytes)`);
  }
  const meta = JSON.parse(metaEntry.getData().toString('utf8')) as ReportMeta;
  if (typeof meta.prNumber !== 'number' || typeof meta.tests !== 'object') {
    throw new Error('meta.json in the proofgate-report artifact is not valid');
  }
  return { meta };
}
