import type { Probot } from 'probot';
import type { GitHubClient } from '../../src/github';
import { fetchBundle } from './artifactZip';
import { handleWorkflowRunCompleted, type WorkflowRunPayload } from './handler';

export default (app: Probot) => {
  app.on('workflow_run.completed', async (context) => {
    const result = await handleWorkflowRunCompleted({
      client: context.octokit as unknown as GitHubClient,
      payload: context.payload as unknown as WorkflowRunPayload,
      fetchBundle,
      log: {
        info: (msg) => context.log.info(msg),
        warning: (msg) => context.log.warn(msg),
      },
    });
    context.log.info(`ProofGate workflow_run handler: ${result}`);
  });
};
