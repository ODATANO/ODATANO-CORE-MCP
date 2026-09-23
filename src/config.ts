/**
 * Server configuration, environment-driven. The connection variables are the
 * same for every ODATANO MCP server (ODATANO_ACCESS_*): one key from
 * https://api.preprod.odatano.dev configures the Cardano and the Midnight server alike.
 * A direct ODATANO instance (local `cds watch`, an own deployment) is reached
 * by pointing ODATANO_ACCESS_URL at it.
 */
export interface OdatanoMcpConfig {
  /** Base URL: the ODATANO ACCESS gateway (default https://api.preprod.odatano.dev) or a direct ODATANO host app. */
  baseUrl: string;
  /**
   * ODATANO_ACCESS_KEY. The usual value is an ODATANO ACCESS key (`oda_...`),
   * sent as `Authorization: Bearer`; the gateway swaps in the agent grant.
   * Against a direct ODATANO instance an `odat_...` agent-grant token goes as
   * `x-agent-token` (optionally alongside basic transport auth); anything
   * else is a plain bearer (XSUAA / `auth: jwt`).
   */
  token?: string;
  /** ODATANO_ACCESS_USER / _PASSWORD: basic auth for a direct instance (CAP mocked/dev auth, e.g. `alice`); never for agents. */
  username?: string;
  password?: string;
  /** Prefix in front of the service names, default `/odata/v4`. */
  servicePrefix: string;
  /**
   * Absolute URL of ODATANO ASTRA, the analytics service. Default `<baseUrl>/odata/v4/astra`,
   * which is where the gateway serves it; an own deployment sets ODATANO_ANALYTICS_URL to its
   * ASTRA instance (its own app on its own port), or leaves it and gets no analytics tools.
   */
  analyticsUrl: string;
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
  const baseUrl = (env.ODATANO_ACCESS_URL || 'https://api.preprod.odatano.dev').replace(/\/+$/, '');
  let servicePrefix = env.ODATANO_SERVICE_PREFIX ?? '/odata/v4';
  if (!servicePrefix.startsWith('/')) servicePrefix = `/${servicePrefix}`;
  servicePrefix = servicePrefix.replace(/\/+$/, '');
  const analyticsUrl = (env.ODATANO_ANALYTICS_URL || `${baseUrl}/odata/v4/astra`).replace(/\/+$/, '');
  return {
    baseUrl,
    token: env.ODATANO_ACCESS_KEY || undefined,
    username: env.ODATANO_ACCESS_USER || undefined,
    password: env.ODATANO_ACCESS_PASSWORD || undefined,
    servicePrefix,
    analyticsUrl,
    timeoutMs: positiveInt('ODATANO_TIMEOUT_MS', env.ODATANO_TIMEOUT_MS, 30000),
    maxRows: positiveInt('ODATANO_MCP_MAX_ROWS', env.ODATANO_MCP_MAX_ROWS, 50),
    enableWalletJobs: bool(env.ODATANO_MCP_ENABLE_WALLET_JOBS),
  };
}
