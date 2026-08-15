/**
 * Server configuration, environment-driven so the same binary works for
 * local dev (CAP mocked auth against a `cds watch` instance) and for a
 * deployed ODATANO behind XSUAA / a reverse proxy (bearer token).
 */
export interface OdatanoMcpConfig {
  /** Base URL of the ODATANO host app, e.g. http://localhost:4004 */
  baseUrl: string;
  /**
   * Token credential. An `odat_...` value is reserved for the planned ODATANO
   * agent-grant token (sent as `x-agent-token`, optionally alongside basic
   * transport auth); anything else is sent as `Authorization: Bearer`.
   */
  token?: string;
  /** Basic-auth credentials for CAP mocked/dev auth (e.g. `alice`). */
  username?: string;
  password?: string;
  /** Prefix in front of the service names, default `/odata/v4`. */
  servicePrefix: string;
  /** Request timeout in milliseconds. */
  timeoutMs: number;
  /** Default `$top` for query tools and cap for arrays in tool output. */
  maxRows: number;
  /** Register the wallet-worker write tools (submit_wallet_job / cancel_wallet_job). */
  enableWalletJobs: boolean;
}

/** ODATANO service names (path segments after the prefix). */
export const SERVICES = {
  odata: 'cardano-odata',
  transaction: 'cardano-transaction',
  sign: 'cardano-sign',
  worker: 'cardano-worker',
  indexer: 'cardano-indexer',
} as const;

export type ServiceKey = keyof typeof SERVICES;

function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return n;
}

function bool(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OdatanoMcpConfig {
  const baseUrl = (env.ODATANO_BASE_URL ?? 'http://localhost:4004').replace(/\/+$/, '');
  let servicePrefix = env.ODATANO_SERVICE_PREFIX ?? '/odata/v4';
  if (!servicePrefix.startsWith('/')) servicePrefix = `/${servicePrefix}`;
  servicePrefix = servicePrefix.replace(/\/+$/, '');
  return {
    baseUrl,
    token: env.ODATANO_TOKEN || undefined,
    username: env.ODATANO_USERNAME || undefined,
    password: env.ODATANO_PASSWORD || undefined,
    servicePrefix,
    timeoutMs: positiveInt('ODATANO_TIMEOUT_MS', env.ODATANO_TIMEOUT_MS, 30000),
    maxRows: positiveInt('ODATANO_MCP_MAX_ROWS', env.ODATANO_MCP_MAX_ROWS, 50),
    enableWalletJobs: bool(env.ODATANO_MCP_ENABLE_WALLET_JOBS),
  };
}
