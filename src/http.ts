import { timingSafeEqual } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export const createHttpApp = (factory: () => McpServer, token: string, host = '127.0.0.1') => {
  if (token.length < 32) throw new Error('HTTP bearer token must contain at least 32 characters');
  const app = createMcpExpressApp({ host, allowedHosts: ['localhost', '127.0.0.1', '[::1]'] });
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use('/mcp', (req, res, next) => {
    const header = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (header.length !== expected.length || !timingSafeEqual(header, expected)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (req.headers.origin) {
      res.status(403).json({ error: 'Browser origins are not supported' });
      return;
    }
    next();
  });
  app.post('/mcp', async (req, res) => {
    const server = factory();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' });
    }
  });
  app.all('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Use POST for stateless MCP' });
  });
  return app;
};
