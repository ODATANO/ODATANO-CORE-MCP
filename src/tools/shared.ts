import { OdatanoApiError, type OdatanoClient } from '../client.js';
import type { OdatanoMcpConfig } from '../config.js';
import { notFound, trimResult } from '../output.js';

export interface ToolContext {
  client: OdatanoClient;
  config: OdatanoMcpConfig;
}

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export interface RunOptions<A> {
  /** Keep CBOR/script hex fields verbatim (tools whose job is returning them). */
  keepCbor?: boolean;
  /** Turn an upstream 404 into `{ found: false, ...detail(args) }` instead of an error. */
  notFoundAs?: (args: A) => Record<string, unknown>;
}

/** Fixed sentence appended to every build tool description. */
export const UNSIGNED_HINT =
  ' Returns UNSIGNED CBOR (unsignedTxCbor) + fee + buildId; NOTHING is signed or submitted. ' +
  'Hand the buildId to create_signing_request so a human / wallet can sign, then submit_signed_transaction.';

export const JSON_HINT = ' JSON parameters may be passed as a JSON string or as a native JSON value.';

/**
 * Uniform handler wrapper: JSON success payloads (trimmed), API errors reported
 * as tool errors (isError) with status + ODATANO code so the agent can react
 * (401 -> credentials, 429 -> back off, 400 ODATANO_INVALID_INPUT -> fix args)
 * instead of crashing the call. Two upstream outcomes are NOT errors for an
 * agent and are normalised: 404 on a lookup (`found: false`) and 409
 * ODATANO_TX_ALREADY_SUBMITTED (`alreadySubmitted: true`).
 */
export function makeRunner(ctx: ToolContext) {
  return function run<A>(fn: (args: A) => Promise<unknown>, opts: RunOptions<A> = {}) {
    return async (args: A): Promise<ToolResult> => {
      try {
        const raw = await fn(args);
        const result = trimResult(raw, { maxRows: ctx.config.maxRows, keepCbor: opts.keepCbor });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        if (err instanceof OdatanoApiError) {
          if (err.status === 404 && opts.notFoundAs) {
            const body = notFound({ ...opts.notFoundAs(args), message: err.message });
            return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
          }
          if (err.status === 409 && err.code === 'ODATANO_TX_ALREADY_SUBMITTED') {
            const body = { alreadySubmitted: true, httpStatus: 409, code: err.code, message: err.message };
            return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
          }
          const detail = { httpStatus: err.status, code: err.code ?? null, message: err.message, ...(err.detail ?? {}) };
          return { content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }], isError: true };
        }
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    };
  };
}
