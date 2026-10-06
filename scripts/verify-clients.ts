/** Validate the exact local stdio bridge and direct Docker stdio transport. */
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root = process.cwd();
const cases = [
  {
    name: 'local-client-bridge',
    command: process.execPath,
    args: [path.join(root, 'dist/proxy.js')],
  },
  {
    name: 'docker-stdio',
    command: 'docker',
    args: [
      'run',
      '--rm',
      '-i',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--user',
      `${process.getuid?.() || 1000}:${process.getgid?.() || 1000}`,
      '--env-file',
      path.join(root, '.local/server.env'),
      '-v',
      `${path.join(root, '.local')}:/run/credentials:ro`,
      'yandex-cloud-management-mcp:local',
    ],
  },
];
for (const item of cases) {
  const client = new Client({ name: 'client-validation', version: '0.2.0' });
  const transport = new StdioClientTransport({
    command: item.command,
    args: item.args,
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    if (tools.tools.length !== 8) throw new Error('Unexpected tool count');
    const result = await client.callTool({
      name: 'yc_read',
      arguments: { service: 'compute.instances', method: 'list', request: { pageSize: 1 } },
    });
    if (result.isError) throw new Error('Cloud read failed');
    console.log('PASS', item.name, 'initialize + 8 tools + live read');
  } finally {
    await client.close();
  }
}
