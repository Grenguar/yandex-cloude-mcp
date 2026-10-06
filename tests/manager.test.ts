import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudManager } from '../src/manager.js';
import { services, describeMethod, validateRequest, getMethod } from '../src/catalog.js';
import { isReadMethod } from '../src/service-specs.js';
import { redact } from '../src/redact.js';
import { readConfig } from '../src/types.js';
import type { Backend } from '../src/types.js';
const config = {
  allowWrites: false,
  folderId: 'fixture-folder',
  timeoutMs: 1000,
  maxOutputBytes: 256000,
};
const backend = (result: unknown = {}) => {
  const calls: unknown[][] = [];
  const api: Backend = {
    async call(...args) {
      calls.push(args);
      return result;
    },
  };
  return { api, calls };
};
test('catalog covers core services, valid codecs and classifies all methods', () => {
  for (const service of [
    'iam.serviceAccounts',
    'compute.instances',
    'compute.instanceGroups',
    'alb.loadBalancers',
    'vpc.networks',
    'postgresql.clusters',
    'storage.buckets',
    'registry.registries',
    'lockbox.secrets',
    'certificates.certificates',
    'logging.entries',
    'quotas.limits',
    'postbox',
  ])
    assert.ok(services[service]);
  assert.equal(isReadMethod('compute.instances', 'futureMutation'), false);
  assert.equal(isReadMethod('logging.entries', 'read'), true);
  for (const [service, spec] of Object.entries(services))
    for (const method of Object.keys(spec.methods)) {
      const description = describeMethod(service, method);
      assert.equal(typeof description.readOnly, 'boolean');
      assert.ok(description.inputSchema);
    }
});
test('rejects typos, wrong scalar/enum/nested fields and unsafe numeric values before dispatch', () => {
  for (const request of [
    { folderID: 'x' },
    { pageSize: 0 },
    { pageSize: 1001 },
    { pageSize: '10' },
  ])
    assert.throws(() => validateRequest('compute.instances', 'list', request));
  for (const view of ['INVALID', 44])
    assert.throws(() => validateRequest('compute.instances', 'get', { instanceId: 'x', view }));
  validateRequest('compute.instances', 'get', { instanceId: 'x', view: 'FULL' });
  assert.throws(() =>
    validateRequest('compute.instances', 'create', { resourcesSpec: { memroy: 123 } }),
  );
  assert.throws(() =>
    validateRequest('compute.instances', 'create', {
      resourcesSpec: { memory: Number.MAX_SAFE_INTEGER + 1 },
    }),
  );
  assert.throws(() =>
    validateRequest('compute.instances', 'list', JSON.parse('{"__proto__":{"admin":true}}')),
  );
  assert.throws(() => getMethod('toString', 'call'));
  assert.throws(() => getMethod('compute.instances', 'constructor'));
});
test('default folder and bounded page size injected, explicit scope and tokens preserved', async () => {
  const b = backend({ nextPageToken: 'next-page' });
  const m = new CloudManager(config, b.api, b.api);
  assert.deepEqual(await m.call('compute.instances', 'list', {}, false), {
    nextPageToken: 'next-page',
  });
  assert.deepEqual(b.calls[0]?.[2], { folderId: 'fixture-folder', pageSize: 100 });
  await m.call(
    'compute.instances',
    'list',
    { folderId: 'explicit', pageToken: 'next-page', pageSize: 2 },
    false,
  );
  assert.deepEqual(b.calls[1]?.[2], { folderId: 'explicit', pageToken: 'next-page', pageSize: 2 });
});
test('write tool and read tool both enforce classification and fail closed', async () => {
  const b = backend();
  const m = new CloudManager(config, b.api, b.api);
  await assert.rejects(
    m.call('compute.instances', 'stop', { instanceId: 'test' }, false),
    /mutates/,
  );
  await assert.rejects(
    m.call('compute.instances', 'stop', { instanceId: 'test' }, true),
    /disabled/,
  );
  assert.equal(b.calls.length, 0);
  const enabled = new CloudManager({ ...config, allowWrites: true }, b.api, b.api);
  await assert.rejects(enabled.call('compute.instances', 'list', {}, true), /yc_read/);
  await enabled.call('compute.instances', 'stop', { instanceId: 'test' }, true);
  assert.equal(b.calls.length, 1);
});
test('management requests for IAM, ALB, VM groups, database and secrets reach the adapter unchanged', async () => {
  const b = backend({ id: 'op-fixture', done: false });
  const m = new CloudManager({ ...config, allowWrites: true }, b.api, b.api);
  const cases: [string, string, Record<string, unknown>][] = [
    ['iam.serviceAccounts', 'create', { folderId: 'f', name: 'mcp-fixture' }],
    [
      'resource.folders',
      'updateAccessBindings',
      {
        resourceId: 'f',
        accessBindingDeltas: [
          {
            action: 'ADD',
            accessBinding: { roleId: 'viewer', subject: { id: 'sa', type: 'serviceAccount' } },
          },
        ],
      },
    ],
    ['alb.loadBalancers', 'stop', { loadBalancerId: 'lb' }],
    ['compute.instanceGroups', 'rollingRestart', { instanceGroupId: 'ig' }],
    ['postgresql.clusters', 'start', { clusterId: 'pg' }],
    [
      'lockbox.secrets',
      'addVersion',
      { secretId: 's', payloadEntries: [{ key: 'test', textValue: 'fake-value' }] },
    ],
  ];
  for (const [service, method, request] of cases) {
    assert.deepEqual(await m.call(service, method, request, true), {
      id: 'op-fixture',
      done: false,
    });
    assert.deepEqual(b.calls.at(-1)?.slice(0, 3), [service, method, request]);
  }
});
test('operation polling distinguishes success, failure and pending', async () => {
  for (const [operation, status] of [
    [{ id: 'op', done: true }, 'completed'],
    [{ id: 'op', done: true, error: { code: 7 } }, 'failed'],
    [{ id: 'op', done: false }, 'pending'],
  ] as const) {
    const b = backend(operation);
    const m = new CloudManager(config, b.api, b.api);
    assert.equal((await m.waitOperation('op', 1000)).status, status);
  }
});
test('redacts secret fields/metadata/binary while preserving page tokens', () => {
  const value = redact({
    privateKey: 'key',
    password: 'pass',
    metadata: { 'user-data': 'secret' },
    entries: [{ textValue: 'secret' }],
    nextPageToken: 'page',
    bytes: Buffer.from('secret'),
  });
  assert.deepEqual(value, {
    privateKey: '[REDACTED]',
    password: '[REDACTED]',
    metadata: '[REDACTED]',
    entries: [{ textValue: '[REDACTED]' }],
    nextPageToken: 'page',
    bytes: '[REDACTED BINARY]',
  });
});
test('oversized response is explicitly omitted, mutation ID retained; provider errors do not leak', async () => {
  const b = backend({ id: 'op', done: false, items: 'x'.repeat(5000) });
  const m = new CloudManager({ ...config, maxOutputBytes: 1000 }, b.api, b.api);
  assert.equal(
    ((await m.call('operations', 'get', { operationId: 'op' }, false)) as any).operationId,
    'op',
  );
  const bad: Backend = {
    async call() {
      throw Object.assign(new Error('password=DO-NOT-LEAK'), { code: 7 });
    },
  };
  const failing = new CloudManager(config, bad, bad);
  await assert.rejects(
    failing.call('compute.instances', 'list', {}, false),
    (e) => !String(e).includes('DO-NOT-LEAK') && String(e).includes('(7)'),
  );
});
test('configuration does not enable writes for truthy strings or invalid limits', () => {
  assert.equal(readConfig({ YC_ALLOW_WRITES: '1' }).allowWrites, false);
  assert.throws(() => readConfig({ YC_TIMEOUT_MS: 'Infinity' }));
});

test('wait expiry during an in-flight operation read reports pending instead of failed mutation', async () => {
  const slow: Backend = {
    async call(_service, _method, _request, signal) {
      return new Promise((_resolve, reject) => {
        const keepAlive = setTimeout(() => reject(new Error('test deadline not delivered')), 2000);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(keepAlive);
            reject(new Error('deadline'));
          },
          { once: true },
        );
      });
    },
  };
  const manager = new CloudManager(config, slow, slow);
  assert.equal((await manager.waitOperation('fixture-op', 1000)).status, 'pending');
});
