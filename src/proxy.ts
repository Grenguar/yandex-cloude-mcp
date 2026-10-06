#!/usr/bin/env node
/** Local stdio-to-HTTP bridge: client configs contain paths, never bearer tokens. */
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const main = async () => {
  const endpoint = new URL(process.env.MCP_SERVER_URL || 'http://127.0.0.1:8765/mcp');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))
    throw new Error('Bridge supports localhost only');
  const token = readFileSync(
    process.env.MCP_HTTP_TOKEN_FILE || new URL('../.local/http-token', import.meta.url),
    'utf8',
  ).trim();
  const client = new Client({ name: 'yandex-cloud-local-bridge', version: '0.2.0' });
  await client.connect(
    new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const server = new Server(
    { name: 'yandex-cloud-management', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, (request) => client.listTools(request.params));
  server.setRequestHandler(CallToolRequestSchema, (request, extra) =>
    client.callTool(request.params, undefined, { signal: extra.signal, timeout: 130000 }),
  );
  await server.connect(new StdioServerTransport());
  const close = () => {
    void Promise.all([client.close(), server.close()]).finally(() => process.exit(0));
  };
  process.stdin.on('end', close);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
};
main().catch(() => {
  console.error(
    'Local Yandex MCP connection failed. Check docker compose ps, endpoint and .local/http-token.',
  );
  process.exit(1);
});
