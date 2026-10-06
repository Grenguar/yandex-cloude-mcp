import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { sdkServices } from '../src/catalog.js';
import { SdkBackend } from '../src/sdk-backend.js';
const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('@yandex-cloud/nodejs-sdk'));
test('every advertised SDK method resolves to a unary service and request codec', () => {
  for (const [service, spec] of Object.entries(sdkServices)) {
    const mod = require(path.join(root, spec.module!));
    const ctor = mod[spec.clientName!];
    for (const [method, definition] of Object.entries(spec.methods)) {
      assert.ok(ctor.service[method], `${service}.${method}`);
      assert.equal(ctor.service[method].responseStream, false);
      const codec = require(path.join(root, definition.requestModule!))[definition.requestType!];
      assert.equal(typeof codec.fromJSON, 'function');
      assert.ok(ctor.service[method].requestSerialize(codec.fromJSON({})) instanceof Uint8Array);
    }
  }
});
test('SDK dispatch decodes JSON enums, uses absolute Date deadlines, disables mutation retries and refreshes tokens', async () => {
  const calls: any[] = [];
  const sessions: string[] = [];
  let token = 'token-1';
  const factory = (value: string) => {
    sessions.push(value);
    return {
      client: () => ({
        get: async (...args: any[]) => {
          calls.push(args);
          return { id: 'vm' };
        },
      }),
    } as any;
  };
  const backend = new SdkBackend(
    sdkServices,
    { getToken: async () => token },
    { allowWrites: false, timeoutMs: 30000, maxOutputBytes: 1000 },
    factory,
  );
  await backend.call('compute.instances', 'get', { instanceId: 'vm', view: 'FULL' });
  assert.equal(calls[0][0].view, 1);
  assert.ok(calls[0][1].deadline instanceof Date);
  assert.ok(calls[0][1].deadline.getTime() - Date.now() > 25000);
  assert.equal(calls[0][1].retry, false);
  await backend.call('compute.instances', 'get', { instanceId: 'vm' });
  assert.equal(sessions.length, 1);
  token = 'token-2';
  await backend.call('compute.instances', 'get', { instanceId: 'vm' });
  assert.deepEqual(sessions, ['token-1', 'token-2']);
});
