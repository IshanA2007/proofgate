import { DefaultArtifactClient } from '@actions/artifact';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { FsLike } from './testRunner';
import type { ReportMeta } from './types';

export const ARTIFACT_NAME = 'proofgate-report';

export interface ReportBundle {
  report: string;
  meta: ReportMeta;
}

/** Uploads the verdict bundle so a privileged relay (workflow_run) or the
 * ProofGate App can deliver it on fork PRs where this job's token is read-only. */
export async function uploadReportBundle(
  bundle: ReportBundle,
  dir = 'proofgate-report',
): Promise<void> {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/report.md`, bundle.report);
  writeFileSync(`${dir}/meta.json`, JSON.stringify(bundle.meta, null, 2));
  const client = new DefaultArtifactClient();
  await client.uploadArtifact(ARTIFACT_NAME, [`${dir}/report.md`, `${dir}/meta.json`], dir);
}

export function readReportBundle(dir: string, fs: FsLike): ReportBundle {
  const report = fs.read(`${dir}/report.md`);
  const meta = JSON.parse(fs.read(`${dir}/meta.json`)) as ReportMeta;
  if (typeof meta.prNumber !== 'number' || typeof meta.tests !== 'object') {
    throw new Error(`${dir}/meta.json is not a valid ProofGate report bundle`);
  }
  return { report, meta };
}
