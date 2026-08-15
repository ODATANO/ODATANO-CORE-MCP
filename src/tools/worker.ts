import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jsonValue, uuid } from '../schemas.js';
import { makeRunner, type ToolContext } from './shared.js';

/*
 * ODATANO v2.0 wallet worker (CardanoWorkerService). Status/read tools are
 * always registered when the service exists. The write tools queue jobs that
 * a SERVER-HELD wallet signs, so they are opt-in (ODATANO_MCP_ENABLE_WALLET_JOBS)
 * and meant to be used with a scoped credential; PauseWorker / ResumeWorker
 * (Admin) are never exposed.
 */

const JOB_KINDS = ['simpleAda', 'metadata', 'multiAsset', 'mint', 'plutusSpend', 'submitSigned'] as const;

export function registerWorkerTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;
  const run = makeRunner(ctx);

  server.registerTool(
    'get_worker_status',
    {
      description:
        'Live wallet-worker summary on the host (ODATANO >= 2.0): running flag, configured wallet ids, ' +
        'in-flight executions, jobs awaiting confirmation, queue depth.',
      inputSchema: {},
    },
    run(async () => client.callFunction('worker', 'GetWorkerStatus')),
  );

  server.registerTool(
    'get_wallet_job_status',
    {
      description:
        'Lifecycle state of a wallet-worker job: status (pending / building / submitting / submitted / ' +
        'confirmed / failed / cancelled), attempt, txHash, fee, error code/message, timestamps. Poll every few ' +
        'seconds until confirmed or failed. Non-admin callers see their own jobs only.',
      inputSchema: {
        jobId: uuid('jobId').describe('Job id returned by submit_wallet_job'),
      },
    },
    run(async (args) => client.callFunction('worker', 'GetJobStatus', { jobId: args.jobId }), {
      notFoundAs: (args) => ({ jobId: args.jobId }),
    }),
  );

  if (!config.enableWalletJobs) return;

  server.registerTool(
    'submit_wallet_job',
    {
      description:
        'Queue an asynchronous transaction job for a SERVER-MANAGED worker wallet (ODATANO >= 2.0): the host ' +
        'builds, signs with the wallet\'s software/HSM key, submits and tracks confirmation. requestJson is the ' +
        'same payload shape as the matching build_* tool (senderAddress is overridden with the wallet address); ' +
        'kind submitSigned takes {signedTxCbor} and only submits. ' +
        'Idempotent per (walletId, kind, idempotencyKey) - a retry returns the original job. Returns ' +
        '{ jobId, status, deduplicated }; poll get_wallet_job_status. THIS MOVES FUNDS once confirmed - only ' +
        'use with an explicit instruction and a wallet you are allowed to spend from.',
      inputSchema: {
        walletId: z.string().min(1).max(50).describe('Configured worker wallet id'),
        kind: z.enum(JOB_KINDS).describe('Job kind: simpleAda | metadata | multiAsset | mint | plutusSpend | submitSigned'),
        requestJson: jsonValue('requestJson', 'object')
          .describe('Build request payload (same fields as the corresponding build_* tool, minus senderAddress)'),
        idempotencyKey: z.string().min(1).max(100).optional().describe('Caller key that dedupes retries (strongly recommended)'),
        priority: z.number().int().optional().describe('Higher runs first within a wallet'),
        notBefore: z.string().datetime().optional().describe('ISO timestamp; do not start before'),
      },
    },
    run(async (args) => client.callAction('worker', 'SubmitWalletJob', args)),
  );

  server.registerTool(
    'cancel_wallet_job',
    {
      description:
        'Cancel a still-pending wallet job. Jobs that already started building may reach the chain and cannot ' +
        'be cancelled (returns false).',
      inputSchema: {
        jobId: uuid('jobId').describe('Job id'),
      },
    },
    run(async (args) => client.callAction('worker', 'CancelJob', { jobId: args.jobId }), {
      notFoundAs: (args) => ({ jobId: args.jobId }),
    }),
  );
}
