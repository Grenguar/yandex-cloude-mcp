#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createTokenProvider } from './auth.js';
import { sdkServices } from './catalog.js';
import { createHttpApp } from './http.js';
import { CloudManager } from './manager.js';
import { PostboxBackend } from './postbox.js';
import { createServer } from './server.js';
import { SdkBackend } from './sdk-backend.js';
import { StorageTools } from './storage.js';
import { readConfig } from './types.js';
const config = readConfig();
const auth = createTokenProvider();
const postboxAuth =
  process.env.YC_POSTBOX_IAM_TOKEN_FILE || process.env.YC_POSTBOX_SERVICE_ACCOUNT_KEY_FILE
    ? createTokenProvider({
        YC_IAM_TOKEN_FILE: process.env.YC_POSTBOX_IAM_TOKEN_FILE,
        YC_SERVICE_ACCOUNT_KEY_FILE: process.env.YC_POSTBOX_SERVICE_ACCOUNT_KEY_FILE,
      })
    : auth;
const manager = new CloudManager(
  config,
  new SdkBackend(sdkServices, auth, config),
  new PostboxBackend(postboxAuth, config),
);
const storage = new StorageTools();
const factory = () => createServer(manager, storage);
const main = async () => {
  if (process.env.MCP_TRANSPORT === 'http') {
    const token = process.env.MCP_HTTP_TOKEN_FILE
      ? readFileSync(process.env.MCP_HTTP_TOKEN_FILE, 'utf8').trim()
      : process.env.MCP_HTTP_TOKEN || '';
    const host = process.env.MCP_HOST || '127.0.0.1';
    const port = Number(process.env.MCP_PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid MCP_PORT');
    const app = createHttpApp(factory, token, host);
    const listener = app.listen(port, host, () =>
      console.error(`Yandex Cloud MCP listening on ${host}:${port}; writes=${config.allowWrites}`),
    );
    const close = () => {
      listener.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  } else {
    const server = factory();
    await server.connect(new StdioServerTransport());
    process.stdin.on('end', () => {
      void server.close().finally(() => process.exit(0));
    });
    const close = () => {
      void server.close().finally(() => process.exit(0));
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  }
};
main().catch(() => {
  console.error('MCP startup failed. Check transport and credential-file configuration.');
  process.exit(1);
});
