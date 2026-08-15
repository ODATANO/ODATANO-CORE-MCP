import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueryString, OdatanoApiError, OdatanoClient, odataLiteral, stripODataNoise } from './client.js';
import { loadConfig } from './config.js';

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
  assert.equal(c.baseUrl, 'http://localhost:4004');
  assert.equal(c.servicePrefix, '/odata/v4');
  assert.equal(c.maxRows, 50);
  assert.equal(c.enableWalletJobs, false);
  const d = loadConfig({ ODATANO_BASE_URL: 'https://h/', ODATANO_SERVICE_PREFIX: 'api/', ODATANO_MCP_ENABLE_WALLET_JOBS: 'true' });
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
    const client = new OdatanoClient(loadConfig({ ODATANO_USERNAME: 'alice', ODATANO_TOKEN: 'odat_abc' }));
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
    await new OdatanoClient(loadConfig({ ODATANO_TOKEN: 'eyJhbGciOi' })).callAction('odata', 'GetLatestBlock');
    assert.equal(auth, 'Bearer eyJhbGciOi');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
