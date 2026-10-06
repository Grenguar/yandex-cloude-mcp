/** Read-only live smoke. Never sends emails or mutates infrastructure. */
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const token = fs.readFileSync('.local/http-token', 'utf8').trim();
const client = new Client({ name: 'yandex-cloud-smoke', version: '0.2.0' });
const failures: string[] = [];
const results = new Map<string, any>();
try {
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(process.env.MCP_SERVER_URL || 'http://127.0.0.1:8765/mcp'),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
    ),
  );
  const listed = await client.listTools();
  console.log('MCP connected; tools:', listed.tools.map((t) => t.name).join(', '));
  const invoke = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content as { type: string; text?: string }[];
    const body = text.find((t) => t.type === 'text')?.text ?? '';
    if (result.isError) throw new Error(body);
    return JSON.parse(body);
  };
  const catalog = await invoke('yc_services', {});
  console.log('Services:', catalog.services.length, 'writesEnabled:', catalog.writesEnabled);
  if (catalog.writesEnabled) throw new Error('Smoke requires read-only mode');
  const cases = [
    ['iam.serviceAccounts', 'list'],
    ['compute.instances', 'list'],
    ['compute.instanceGroups', 'list'],
    ['alb.loadBalancers', 'list'],
    ['alb.backendGroups', 'list'],
    ['alb.httpRouters', 'list'],
    ['vpc.networks', 'list'],
    ['vpc.subnets', 'list'],
    ['vpc.securityGroups', 'list'],
    ['postgresql.clusters', 'list'],
    ['storage.buckets', 'list'],
    ['registry.registries', 'list'],
    ['lockbox.secrets', 'list'],
    ['certificates.certificates', 'list'],
    ['logging.groups', 'list'],
    ['postbox', 'listIdentities'],
    ['postbox', 'listConfigurationSets'],
  ];
  for (const [service, method] of cases) {
    try {
      const data = await invoke('yc_read', { service, method, request: {} });
      results.set(service!, { ...results.get(service!), ...data });
      const counts = Object.fromEntries(
        Object.entries(data)
          .filter(([, v]) => Array.isArray(v))
          .map(([k, v]) => [k, (v as unknown[]).length]),
      );
      console.log('PASS', service, method, JSON.stringify(counts));
    } catch (error) {
      failures.push(`${service}.${method}`);
      console.log('FAIL', service, method, (error as Error).message);
    }
  }
  const extraRead = async (
    label: string,
    service: string,
    method: string,
    request: Record<string, unknown>,
  ) => {
    try {
      const data = await invoke('yc_read', { service, method, request });
      console.log('PASS', label);
      return data;
    } catch (error) {
      failures.push(label);
      console.log('FAIL', label, (error as Error).message);
    }
  };
  const folder = await extraRead('Folder/cloud scope', 'resource.folders', 'get', {
    folderId: catalog.defaultFolderId,
  });
  if (folder?.cloudId)
    await extraRead('Postbox quota limits', 'quotas.limits', 'list', {
      resource: { id: folder.cloudId, type: 'resource-manager.cloud' },
      service: 'postbox',
    });
  const groups = results.get('logging.groups')?.groups;
  if (groups?.length)
    await extraRead('Bounded log read', 'logging.entries', 'read', {
      criteria: {
        logGroupId: groups[0].id,
        pageSize: 1,
        maxResponseSize: 64000,
        since: new Date(Date.now() - 900000).toISOString(),
        until: new Date().toISOString(),
      },
    });
  const identities = results.get('postbox')?.EmailIdentities;
  if (identities?.length)
    await extraRead('Postbox identity details', 'postbox', 'getIdentity', {
      EmailIdentity: identities[0].IdentityName,
    });
  const instances = results.get('compute.instances')?.instances;
  if (instances?.length) {
    const operations = await extraRead(
      'VM operation history',
      'compute.instances',
      'listOperations',
      { instanceId: instances[0].id, pageSize: 1 },
    );
    if (operations?.operations?.length)
      await extraRead('Operation status', 'operations', 'get', {
        operationId: operations.operations[0].id,
      });
  }
  console.log('Failed calls:', failures.length ? failures.join(', ') : 'none');
  if (failures.length) process.exitCode = 1;
} finally {
  await client.close();
}
