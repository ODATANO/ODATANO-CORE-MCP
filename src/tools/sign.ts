import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bech32Address, hexString, network, uuid } from '../schemas.js';
import { makeRunner, type ToolContext } from './shared.js';

/*
 * Signing handoff, verification and submit. The MCP server never signs:
 * a build becomes a signing request whose instructions a human, a CIP-30
 * wallet or a CLI fulfil; the agent then verifies and/or submits the signed
 * CBOR. HSM signing (SignWithHsm / SignAndSubmitWithHsm) is deliberately not
 * exposed - that is a server-held key, i.e. the wallet the agent must not have.
 */

const signerType = z.enum(['cardano-cli', 'browser-wallet', 'hardware-wallet', 'custom'])
  .describe('Which kind of signer produced the CBOR');

export function registerSignTools(server: McpServer, ctx: ToolContext): void {
  const { client } = ctx;
  const run = makeRunner(ctx);

  server.registerTool(
    'create_signing_request',
    {
      description:
        'Turn a build into a signing request for EXTERNAL signing: returns signingRequestId, the unsigned CBOR, ' +
        'human-readable signing instructions and a ready-to-run cardano-cli command. This is the artefact you ' +
        'hand to the human / wallet owner. State machine: pending -> verified (verify_signature) -> submitted ' +
        '(submit_verified_transaction). Persisted for audit.',
      inputSchema: {
        buildId: uuid('buildId').describe('Build id from a build_* tool'),
        message: z.string().max(500).optional().describe('Optional note shown to the signer (what this tx is for)'),
      },
    },
    run(async (args) => client.callAction('sign', 'CreateSigningRequest', args), {
      keepCbor: true,
      notFoundAs: (args) => ({ buildId: args.buildId }),
    }),
  );

  server.registerTool(
    'get_signing_request',
    {
      description: 'Signing request by id: status (pending / verified / submitted / failed), build, instructions, tx hash once submitted.',
      inputSchema: {
        signingRequestId: uuid('signingRequestId').describe('Signing request id'),
      },
    },
    run(async (args) => client.callAction('sign', 'GetSigningRequest', { signingRequestId: args.signingRequestId }), {
      keepCbor: true,
      notFoundAs: (args) => ({ signingRequestId: args.signingRequestId }),
    }),
  );

  server.registerTool(
    'list_signing_requests',
    {
      description: 'Signing requests created for a sender address (newest first): id, status, buildId, created time.',
      inputSchema: {
        address: bech32Address.describe('Sender address (bech32)'),
      },
    },
    run(async (args) => client.callAction('sign', 'GetSigningRequestsByAddress', { address: args.address }), {
      notFoundAs: (args) => ({ address: args.address }),
    }),
  );

  server.registerTool(
    'verify_signature',
    {
      description:
        'Verify a signed transaction CBOR against its signing request WITHOUT submitting: checks that the body ' +
        'matches the build and that valid Ed25519 witnesses exist for the fee payer and every required signer. ' +
        'Stores the verification for audit and moves the request to "verified". Optionally binds the request ' +
        'to a sender address.',
      inputSchema: {
        signingRequestId: uuid('signingRequestId').describe('Signing request id'),
        signedTxCbor: hexString('signedTxCbor').describe('Signed transaction CBOR (hex)'),
        signerType,
        signerInfo: z.string().max(100).optional().describe('Free-text signer info (wallet name, operator, ...)'),
        address: bech32Address.optional().describe('Optional sender address for ownership verification'),
      },
    },
    run(async (args) => client.callAction('sign', 'VerifySignature', args)),
  );

  server.registerTool(
    'verify_data_signature',
    {
      description:
        'Verify a CIP-30 signData (COSE_Sign1) message signature against a bech32 address: Ed25519 signature ' +
        'valid, signer key hashes to the address payment credential, and (optionally) the signed payload equals ' +
        'expectedPayload (anti-replay). Stateless - no DB write, no key access. Use for wallet-based login / ' +
        'consent proofs. Returns { valid, reason?, signedPayload, signerVkh }.',
      inputSchema: {
        address: bech32Address.describe('Address the wallet claimed to sign with'),
        coseSignature: hexString('coseSignature').describe('Hex COSE_Sign1 CBOR (the `signature` field from signData)'),
        coseKey: hexString('coseKey').describe('Hex COSE_Key CBOR (the `key` field from signData)'),
        expectedPayload: z.string().max(10000).optional().describe('Optional expected UTF-8 payload; when set the signed payload must equal it'),
      },
    },
    run(async (args) => client.callAction('sign', 'VerifyDataSignature', args)),
  );

  server.registerTool(
    'submit_signed_transaction',
    {
      description:
        'Submit an ALREADY SIGNED transaction CBOR to the Cardano network. Two modes: with buildId the host ' +
        'checks the CBOR against the recorded build and links the submission to it; without buildId pass ' +
        'network and the raw signed CBOR is submitted as-is (parse_transaction_cbor first if unsure). ' +
        'This tool only submits - the CBOR must already carry valid witnesses; the host will reject unsigned ' +
        'or mis-signed CBOR. Returns { id (submissionId), txHash, status }. A duplicate submit returns ' +
        'alreadySubmitted:true rather than an error.',
      inputSchema: {
        signedTxCbor: hexString('signedTxCbor').describe('Signed transaction CBOR (hex)'),
        buildId: uuid('buildId').optional().describe('Build id to submit against (preferred)'),
        network: network.optional().describe('Required when no buildId: the network the host must submit to (safety check)'),
      },
    },
    run(async (args) => {
      if (args.buildId) {
        return client.callAction('transaction', 'SubmitTransaction', { buildId: args.buildId, signedTxCbor: args.signedTxCbor });
      }
      if (!args.network) throw new Error('pass buildId, or network for a raw signed CBOR submit');
      return client.callAction('transaction', 'SubmitSignedTransaction', { signedTxCbor: args.signedTxCbor, network: args.network });
    }),
  );

  server.registerTool(
    'submit_verified_transaction',
    {
      description:
        'Verify + submit in one step for a signing request: runs the same checks as verify_signature, then ' +
        'submits, updates the request to "submitted" and records the submission. deferSubmit=true returns ' +
        'immediately with the tx hash and status pending while the network submit happens detached (track via ' +
        'get_signing_request / get_submission_status).',
      inputSchema: {
        signingRequestId: uuid('signingRequestId').describe('Signing request id'),
        signedTxCbor: hexString('signedTxCbor').describe('Signed transaction CBOR (hex)'),
        signerType,
        signerInfo: z.string().max(100).optional().describe('Free-text signer info'),
        address: bech32Address.optional().describe('Optional sender address for ownership verification'),
        deferSubmit: z.boolean().optional().describe('Return after verify + claim; submit runs detached'),
      },
    },
    run(async (args) => client.callAction('sign', 'SubmitVerifiedTransaction', args)),
  );

  server.registerTool(
    'get_submission_status',
    {
      description:
        'Status of a transaction submission by submission id: pending -> submitted -> confirmed | failed. ' +
        'With refresh=true the host re-queries the chain for confirmation before answering (bound action ' +
        'CheckSubmissionStatus; only meaningful while status is submitted).',
      inputSchema: {
        submissionId: uuid('submissionId').describe('Submission id (`id` from a submit_* result)'),
        refresh: z.boolean().optional().describe('Re-check the chain for confirmation first (default false)'),
      },
    },
    run(async (args) => {
      if (args.refresh) {
        return client.callBoundAction(
          'transaction', 'TransactionSubmissions', args.submissionId,
          'CardanoTransactionService.CheckSubmissionStatus',
        );
      }
      return client.readEntity('transaction', 'TransactionSubmissions', args.submissionId);
    }, { notFoundAs: (args) => ({ submissionId: args.submissionId }) }),
  );
}
