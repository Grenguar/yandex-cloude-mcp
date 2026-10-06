import { test } from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CloudManager } from '../src/manager.js';
import { createServer } from '../src/server.js';
import { StorageTools } from '../src/storage.js';
import { createHttpApp } from '../src/http.js';
const config = { allowWrites: false, folderId: 'fixture', timeoutMs: 1000, maxOutputBytes: 256000 };
const backend = {
  async call() {
    return {
      instances: [{ id: 'fixture-vm', metadata: { password: 'hidden' } }],
      nextPageToken: 'page-2',
    };
  },
};
const factory = () =>
  createServer(new CloudManager(config, backend, backend), new StorageTools({}));
test('MCP initialize/list/read/describe/error contracts work end to end', async () => {
  const server = factory();
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 8);
    assert.equal(tools.find((t) => t.name === 'yc_write')?.annotations?.readOnlyHint, false);
    assert.equal(tools.find((t) => t.name === 'yc_read')?.annotations?.readOnlyHint, true);
    const result = await client.callTool({
      name: 'yc_read',
      arguments: { service: 'compute.instances', method: 'list', request: {} },
    });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result), /page-2/);
    assert.doesNotMatch(JSON.stringify(result), /hidden/);
    const fail = await client.callTool({
      name: 'yc_read',
      arguments: { service: 'compute.instances', method: 'stop', request: { instanceId: 'x' } },
    });
    assert.equal(fail.isError, true);
    const schema = await client.callTool({
      name: 'yc_describe',
      arguments: { service: 'compute.instances', method: 'create' },
    });
    const text = (schema.content as { text: string }[])[0]!.text;
    const parsed = JSON.parse(text);
    const defs = parsed.inputSchema.$defs;
    const root = defs[parsed.inputSchema.$ref.replace('#/$defs/', '')];
    assert.equal(
      typeof root.properties.metadata,
      'object',
      'request metadata schema must not be redacted',
    );
  } finally {
    await client.close();
    await server.close();
  }
});
test('HTTP authenticates, rejects browser origins and completes real SDK transport handshake', async () => {
  const token = 'a'.repeat(64);
  const app = createHttpApp(factory, token);
  const listener = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => listener.once('listening', resolve));
  const address = listener.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/mcp', { method: 'POST' })).status, 401);
    assert.equal(
      (
        await fetch(base + '/mcp', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' },
        })
      ).status,
      403,
    );
    const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        base + '/mcp',
        { method: 'POST', headers: { Host: 'evil.example', Authorization: `Bearer ${token}` } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(badHostStatus, 403);
    const client = new Client({ name: 'http-test', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    assert.equal((await client.listTools()).tools.length, 8);
    const res = await client.callTool({
      name: 'yc_read',
      arguments: { service: 'compute.instances', method: 'list', request: {} },
    });
    assert.equal(res.isError, undefined);
    await client.close();
  } finally {
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
});
