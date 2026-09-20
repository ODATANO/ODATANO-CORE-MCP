import { SERVICES, type OdatanoMcpConfig, type ServiceKey } from './config.js';

/** Error carrying the OData error body of a failed ODATANO call. */
export class OdatanoApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
    /** Extra fields of a gateway error body (unitsLeft, price, topup, products, validUntil, retryAfterSeconds). */
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'OdatanoApiError';
  }
}

/**
 * Two error shapes reach the client: CAP's `{ error: { code, message } }`
 * from ODATANO itself, and the ODATANO ACCESS gateway's `{ error: "<text>",
 * ...detail }` (401 key problems, 402 units exhausted with a top-up hint,
 * 403 closed service or product not on the key, 429 with Retry-After).
 */
export function apiError(status: number, payload: unknown, headers: Headers, fallback: string): OdatanoApiError {
  const body = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const err = body.error;
  if (typeof err === 'string') {
    const { error: _e, ...rest } = body;
    const detail: Record<string, unknown> = { ...rest };
    const retry = headers.get('retry-after');
    if (retry) detail.retryAfterSeconds = Number(retry);
    return new OdatanoApiError(status, undefined, err, Object.keys(detail).length ? detail : undefined);
  }
  const e = (err ?? {}) as { code?: string; message?: string };
  return new OdatanoApiError(status, e.code, e.message ?? fallback);
}

/** OData system query options accepted by {@link OdatanoClient.queryEntity}. */
export interface EntityQuery {
  filter?: string;
  select?: string;
  expand?: string;
  orderby?: string;
  top?: number;
  skip?: number;
  count?: boolean;
}

/**
 * Minimal OData V4 client for the ODATANO services. Three verbs:
 * - unbound actions (POST, JSON body) — all ODATANO read/build/sign operations
 * - unbound functions (GET, parameters inline) — the two v2.0 status functions
 * - entity reads (GET with $filter/$select/... ) — the generic query tool
 * plus a bound action on a single entity (CheckSubmissionStatus).
 */
export class OdatanoClient {
  constructor(private readonly config: OdatanoMcpConfig) {}

  serviceUrl(service: ServiceKey): string {
    return `${this.config.baseUrl}${this.config.servicePrefix}/${SERVICES[service]}`;
  }

  /** POST <service>/<name> with the provided parameters as JSON body (undefined dropped). */
  async callAction(service: ServiceKey, name: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      body[key] = value;
    }
    return this.request('POST', `${this.serviceUrl(service)}/${name}`, body);
  }

  /** POST <service>/<Entity>(<key>)/<Service>.<name> — bound action on one entity. */
  async callBoundAction(
    service: ServiceKey,
    entity: string,
    key: string,
    qualifiedName: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    const url = `${this.serviceUrl(service)}/${entity}(${odataLiteral(key)})/${qualifiedName}`;
    return this.request('POST', url, params);
  }

  /** GET <service>/<name>(p1=...,p2=...) with only the provided parameters. */
  async callFunction(service: ServiceKey, name: string, params: Record<string, string | number | undefined> = {}): Promise<unknown> {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      parts.push(`${key}=${odataLiteral(value)}`);
    }
    return this.request('GET', `${this.serviceUrl(service)}/${name}(${parts.join(',')})`);
  }

  /** GET <service>/<Entity>?$filter=...&$top=... — returns the raw OData collection payload. */
  async queryEntity(service: ServiceKey, entity: string, query: EntityQuery = {}): Promise<unknown> {
    const qs = buildQueryString(query);
    return this.request('GET', `${this.serviceUrl(service)}/${entity}${qs}`);
  }

  /** GET <service>/<Entity>(<key>) — single entity by key. */
  async readEntity(service: ServiceKey, entity: string, key: string, expand?: string): Promise<unknown> {
    const qs = expand ? `?$expand=${encodeURIComponent(expand)}` : '';
    return this.request('GET', `${this.serviceUrl(service)}/${entity}(${odataLiteral(key)})${qs}`);
  }

  /**
   * Cheap capability probe: does `<service>/$metadata` answer 200? Used at
   * startup to register the v2.0 worker/indexer tools only when they are
   * reachable. `closed` = the ODATANO ACCESS gateway answers 403 (operator
   * services are not offered through the key), `absent` = 404 or no answer
   * (core < 2.0, unreachable).
   */
  async serviceStatus(service: ServiceKey): Promise<'served' | 'closed' | 'absent'> {
    try {
      const response = await fetch(`${this.serviceUrl(service)}/$metadata`, {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(Math.min(this.config.timeoutMs, 10000)),
      });
      // Consume the body so the socket is released.
      await response.arrayBuffer().catch(() => undefined);
      if (response.ok) return 'served';
      return response.status === 403 ? 'closed' : 'absent';
    } catch {
      return 'absent';
    }
  }

  async serviceExists(service: ServiceKey): Promise<boolean> {
    return (await this.serviceStatus(service)) === 'served';
  }

  private headers(hasBody = false): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const basic = this.config.username
      ? `Basic ${Buffer.from(`${this.config.username}:${this.config.password ?? ''}`).toString('base64')}`
      : undefined;
    if (this.config.token?.startsWith('odat_')) {
      // Reserved for the ODATANO agent-grant token: travels in its own header
      // so it never collides with the host app's transport auth.
      headers['x-agent-token'] = this.config.token;
      if (basic) headers.Authorization = basic;
    } else if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    } else if (basic) {
      headers.Authorization = basic;
    }
    if (hasBody) headers['Content-Type'] = 'application/json';
    return headers;
  }

  private async request(method: 'GET' | 'POST', url: string, body?: unknown): Promise<unknown> {
    const response = await fetch(url, {
      method,
      headers: this.headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      throw apiError(response.status, payload, response.headers, `ODATANO request failed with HTTP ${response.status}`);
    }
    return stripODataNoise(payload);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Encode a JS value as an OData URL literal: numbers and Edm.Guid keys are
 * unquoted, everything else is a quoted string with '' escaping.
 */
export function odataLiteral(value: string | number): string {
  if (typeof value === 'number') return String(value);
  if (UUID_RE.test(value)) return value.toLowerCase();
  return `'${value.replace(/'/g, "''")}'`;
}

/** Build the `?$filter=...` query string; only provided options are emitted. */
export function buildQueryString(query: EntityQuery): string {
  const parts: string[] = [];
  const add = (name: string, value: string | number | boolean | undefined) => {
    if (value === undefined || value === '') return;
    parts.push(`$${name}=${encodeURIComponent(String(value))}`);
  };
  add('filter', query.filter);
  add('select', query.select);
  add('expand', query.expand);
  add('orderby', query.orderby);
  add('top', query.top);
  add('skip', query.skip);
  if (query.count) add('count', 'true');
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * Drop @odata.* metadata keys so tool output stays clean for the model.
 * `@odata.count` on a collection is preserved as `count`; the `value`
 * array of a collection response is kept as-is (trimming happens later).
 */
export function stripODataNoise(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (key === '@odata.count') { out.count = value; continue; }
    if (key.startsWith('@odata')) continue;
    out[key] = value;
  }
  return out;
}
