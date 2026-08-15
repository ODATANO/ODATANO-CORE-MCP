/**
 * Output hygiene for tool results: cap long arrays and elide huge CBOR/hex
 * blobs nested inside results so a single tool call cannot flood the agent's
 * context. The tools whose purpose IS returning CBOR (build_*, get_build_details,
 * parse_transaction_cbor) call {@link trimResult} with `keepCbor: true`.
 */

const CBOR_KEYS = new Set([
  'unsignedTxCbor', 'signedTxCbor', 'txCbor', 'cbor', 'rawCbor',
  'validatorScript', 'mintingPolicyScript', 'referenceScriptHex', 'scriptCbor',
]);

export interface TrimOptions {
  /** Max elements kept in any array (top-level `value` and nested). */
  maxRows: number;
  /** Keep CBOR/script hex fields verbatim (default: elide above `cborLimit`). */
  keepCbor?: boolean;
  /** Character limit above which CBOR-ish string fields are elided. */
  cborLimit?: number;
}

export function trimResult(payload: unknown, opts: TrimOptions): unknown {
  const cborLimit = opts.cborLimit ?? 8192;
  return walk(payload, 0);

  function walk(value: unknown, depth: number): unknown {
    if (Array.isArray(value)) {
      const kept = value.slice(0, opts.maxRows).map((v) => walk(v, depth + 1));
      if (value.length > opts.maxRows) {
        // Arrays cannot carry a marker without changing element types, so
        // the truncation notice is appended as a final string element.
        kept.push(`… ${value.length - opts.maxRows} more item(s) truncated (limit ${opts.maxRows}); narrow with $filter/$top or increase ODATANO_MCP_MAX_ROWS`);
      }
      return kept;
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (!opts.keepCbor && typeof v === 'string' && CBOR_KEYS.has(k) && v.length > cborLimit) {
          out[k] = `<${k}: ${v.length} hex chars elided — use get_build_details / get_signing_request to fetch it>`;
          continue;
        }
        out[k] = walk(v, depth + 1);
      }
      return out;
    }
    return value;
  }
}

/**
 * Convert a 404 from a Get* read into the "clean negative" shape used across
 * ODATANO/NIGHTGATE MCP servers: `{ found: false, ... }` instead of an error.
 */
export function notFound(detail: Record<string, unknown>): Record<string, unknown> {
  return { found: false, ...detail };
}
