import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueryString, OdatanoApiError, OdatanoClient, odataLiteral, stripODataNoise } from './client.js';
import { loadConfig } from './config.js';
import { sinceDay } from './tools/analytics.js';

test('odataLiteral quotes strings, escapes quotes, leaves numbers and GUIDs bare', () => {
  assert.equal(odataLiteral(5), '5');
  assert.equal(odataLiteral("o'neil"), "'o''neil'");
  assert.equal(odataLiteral('2B8216B4-28B5-292A-4B13-075CF37B2643'), '2b8216b4-28b5-292a-4b13-075cf37b2643');
  assert.equal(odataLiteral('a'.repeat(64)), `'${'a'.repeat(64)}'`);
});

test('buildQueryString emits only provided options, encoded', () => {
  assert.equal(buildQueryString({}), '');
  assert.equal(
    buildQueryString({ filter: "fee gt 500000 and status eq 'ok'", top: 10, count: true }),
    "?$filter=fee%20gt%20500000%20and%20status%20eq%20'ok'&$top=10&$count=true",
  );
});

test('stripODataNoise drops @odata.* but keeps @odata.count as count', () => {
  const out = stripODataNoise({ '@odata.context': 'x', '@odata.count': 7, value: [1] });
  assert.deepEqual(out, { count: 7, value: [1] });
});

test('loadConfig defaults + prefix normalisation + validation', () => {
  const c = loadConfig({});
  assert.equal(c.baseUrl, 'https://api.preprod.odatano.dev');
  assert.equal(c.servicePrefix, '/odata/v4');
  assert.equal(c.maxRows, 50);
  assert.equal(c.enableWalletJobs, false);
  const d = loadConfig({ ODATANO_ACCESS_URL: 'https://h/', ODATANO_SERVICE_PREFIX: 'api/', ODATANO_MCP_ENABLE_WALLET_JOBS: 'true' });
  assert.equal(d.baseUrl, 'https://h');
  assert.equal(d.servicePrefix, '/api');
  assert.equal(d.enableWalletJobs, true);
  assert.throws(() => loadConfig({ ODATANO_TIMEOUT_MS: '-1' }), /Invalid ODATANO_TIMEOUT_MS/);
});

test('OdatanoClient builds service URLs, auth headers and surfaces OData errors', async () => {
  const seen: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    seen.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: init?.headers as Record<string, string>,
      body: init?.body as string | undefined,
    });
    if (String(url).includes('/GetBlockByHash')) {
      return new Response(JSON.stringify({ error: { code: 'ODATANO_NOT_FOUND', message: 'nope' } }), { status: 404 });
    }
    return new Response(JSON.stringify({ '@odata.context': 'c', hash: 'h' }), { status: 200 });
  }) as typeof fetch;
  try {
    const client = new OdatanoClient(loadConfig({ ODATANO_ACCESS_URL: 'http://localhost:4004', ODATANO_ACCESS_USER: 'alice', ODATANO_ACCESS_KEY: 'odat_abc' }));
    const ok = await client.callAction('odata', 'GetLatestBlock', { skip: undefined, keep: 1 });
    assert.deepEqual(ok, { hash: 'h' });
    assert.equal(seen[0].url, 'http://localhost:4004/odata/v4/cardano-odata/GetLatestBlock');
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].body, '{"keep":1}');
    assert.equal(seen[0].headers['x-agent-token'], 'odat_abc');
    assert.equal(seen[0].headers.Authorization, `Basic ${Buffer.from('alice:').toString('base64')}`);

    await client.callFunction('worker', 'GetJobStatus', { jobId: '0f8fad5b-d9cb-469f-a165-70867728950e' });
    assert.equal(seen[1].url, 'http://localhost:4004/odata/v4/cardano-worker/GetJobStatus(jobId=0f8fad5b-d9cb-469f-a165-70867728950e)');
    assert.equal(seen[1].method, 'GET');

    await client.queryEntity('odata', 'Blocks', { top: 2, orderby: 'height desc' });
    assert.equal(seen[2].url, 'http://localhost:4004/odata/v4/cardano-odata/Blocks?$orderby=height%20desc&$top=2');

    await client.callBoundAction('transaction', 'TransactionSubmissions', '0f8fad5b-d9cb-469f-a165-70867728950e', 'CardanoTransactionService.CheckSubmissionStatus');
    assert.equal(seen[3].url, 'http://localhost:4004/odata/v4/cardano-transaction/TransactionSubmissions(0f8fad5b-d9cb-469f-a165-70867728950e)/CardanoTransactionService.CheckSubmissionStatus');

    await assert.rejects(
      client.callAction('odata', 'GetBlockByHash', { hash: 'x' }),
      (err: unknown) => err instanceof OdatanoApiError && err.status === 404 && err.code === 'ODATANO_NOT_FOUND',
    );
    // An ODATANO ACCESS key (oda_…) is a plain bearer: the gateway resolves the grant underneath.
    const viaGateway = new OdatanoClient(loadConfig({ ODATANO_ACCESS_KEY: 'oda_' + 'f'.repeat(40) }));
    await viaGateway.callAction('odata', 'GetLatestBlock', { keep: 1 });
    const gw = seen[seen.length - 1];
    assert.equal(gw.url, 'https://api.preprod.odatano.dev/odata/v4/cardano-odata/GetLatestBlock');
    assert.equal(gw.headers.Authorization, 'Bearer oda_' + 'f'.repeat(40));
    assert.equal(gw.headers['x-agent-token'], undefined);

  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bearer token is used when the token is not an agent grant', async () => {
  const originalFetch = globalThis.fetch;
  let auth: string | undefined;
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    auth = (init?.headers as Record<string, string>).Authorization;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    await new OdatanoClient(loadConfig({ ODATANO_ACCESS_KEY: 'eyJhbGciOi' })).callAction('odata', 'GetLatestBlock');
    assert.equal(auth, 'Bearer eyJhbGciOi');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('gateway error bodies keep their text and detail (402 units exhausted, 429 Retry-After)', async () => {
  const originalFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async () => {
    n += 1;
    if (n === 1) {
      const body = { error: 'units exhausted', key: 'oda_5c71c95b', price: 1, unitsLeft: 0, action: 'GetLatestBlock', topup: { hint: 'buy a pack with x402 at POST /topup, redeem a giveaway code at POST /codes/redeem, or ask the operator for a top-up', codes: 'https://api.preprod.odatano.dev/codes/redeem' } };
      return new Response(JSON.stringify(body), { status: 402, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'rate limited' }), { status: 429, headers: { 'retry-after': '7' } });
  }) as typeof fetch;
  try {
    const client = new OdatanoClient(loadConfig({ ODATANO_ACCESS_KEY: 'oda_' + 'f'.repeat(40) }));
    await assert.rejects(
      client.callAction('odata', 'GetLatestBlock'),
      (err: unknown) => err instanceof OdatanoApiError && err.status === 402 && err.message === 'units exhausted' && err.code === undefined
        && err.detail?.unitsLeft === 0 && (err.detail?.topup as { hint: string }).hint.startsWith('buy a pack'),
    );
    await assert.rejects(
      client.callAction('odata', 'GetLatestBlock'),
      (err: unknown) => err instanceof OdatanoApiError && err.status === 429 && err.message === 'rate limited' && err.detail?.retryAfterSeconds === 7,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('serviceStatus tells served / closed (gateway 403) / absent apart', async () => {
  const originalFetch = globalThis.fetch;
  const answers: number[] = [200, 403, 404];
  globalThis.fetch = (async () => new Response('', { status: answers.shift() ?? 500 })) as typeof fetch;
  try {
    const client = new OdatanoClient(loadConfig({ ODATANO_ACCESS_KEY: 'oda_' + 'f'.repeat(40) }));
    assert.equal(await client.serviceStatus('worker'), 'served');
    assert.equal(await client.serviceStatus('worker'), 'closed');
    assert.equal(await client.serviceStatus('indexer'), 'absent');
    globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
    assert.equal(await client.serviceStatus('indexer'), 'absent');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('analytics: ODATANO ASTRA on the same host, its own path, its own probe', async () => {
  const seen: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    seen.push(String(url));
    if (String(url).endsWith('/$metadata')) return new Response('', { status: 403 });
    return new Response(JSON.stringify({ '@odata.context': 'c', value: [{ chain: 'cardano' }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const client = new OdatanoClient(loadConfig({ ODATANO_ACCESS_KEY: 'oda_' + 'f'.repeat(40) }));
    assert.equal(client.analyticsUrl(), 'https://api.preprod.odatano.dev/odata/v4/astra');
    const out = await client.analyticsQuery('KeyFigures', { filter: "chain eq 'cardano' and window eq '7d'", orderby: 'metric' });
    assert.deepEqual(out, { value: [{ chain: 'cardano' }] });
    assert.equal(seen[0], "https://api.preprod.odatano.dev/odata/v4/astra/KeyFigures?$filter=chain%20eq%20'cardano'%20and%20window%20eq%20'7d'&$orderby=metric");
    await client.analyticsFunction('getWindow', { chain: 'cardano', metric: 'tx.count', window: '24h' });
    assert.equal(seen[1], "https://api.preprod.odatano.dev/odata/v4/astra/getWindow(chain='cardano',metric='tx.count',window='24h')");
    assert.equal(await client.analyticsStatus(), 'closed');
    assert.equal(loadConfig({ ODATANO_ACCESS_URL: 'http://localhost:4004' }).analyticsUrl, 'http://localhost:4004/odata/v4/astra');
    assert.equal(loadConfig({ ODATANO_ANALYTICS_URL: 'http://localhost:4017/odata/v4/astra/' }).analyticsUrl, 'http://localhost:4017/odata/v4/astra');
    assert.equal(sinceDay(1, Date.UTC(2026, 8, 23, 10)), '2026-09-23');
    assert.equal(sinceDay(14, Date.UTC(2026, 8, 23, 10)), '2026-09-10');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
