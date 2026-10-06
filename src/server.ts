import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { describeMethod, services, InputError } from './catalog.js';
import type { CloudManager } from './manager.js';
import type { StorageTools } from './storage.js';
import { redact, safeError, CloudApiError } from './redact.js';
const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};
export const createServer = (manager: CloudManager, storage: StorageTools) => {
  const server = new McpServer({ name: 'yandex-cloud-management', version: '0.2.0' });
  const wrap = async (fn: () => Promise<unknown> | unknown, sanitize = true) => {
    try {
      const raw = await fn();
      const result = sanitize ? redact(raw) : raw;
      const text = JSON.stringify(result);
      return {
        content: [
          {
            type: 'text' as const,
            text:
              Buffer.byteLength(text) <= manager.config.maxOutputBytes
                ? text
                : JSON.stringify({
                    outputOmitted: true,
                    reason:
                      'Output exceeds the configured byte limit. Narrow the request or increase YC_MAX_OUTPUT_BYTES.',
                  }),
          },
        ],
      };
    } catch (error) {
      const message =
        error instanceof InputError || error instanceof CloudApiError
          ? error.message
          : safeError(error);
      return { isError: true, content: [{ type: 'text' as const, text: message }] };
    }
  };
  server.registerTool(
    'yc_services',
    {
      description:
        'Discover supported Yandex Cloud services and methods. Use yc_describe for request fields, then yc_read/yc_write. Folder scope is credentials + explicit/default folderId, not a security sandbox.',
      inputSchema: { service: z.string().optional() },
      annotations: readAnnotations,
    },
    ({ service }) =>
      wrap(() => ({
        writesEnabled: manager.config.allowWrites,
        defaultFolderId: manager.config.folderId,
        services: Object.entries(services)
          .filter(([id]) => !service || id === service || id.startsWith(service + '.'))
          .map(([id, spec]) => ({
            service: id,
            methods: Object.entries(spec.methods).map(([method, s]) => ({
              method,
              readOnly: s.readOnly,
            })),
          })),
      })),
  );
  server.registerTool(
    'yc_describe',
    {
      description:
        'Get the SDK-derived JSON request schema for one method. Unknown request fields are rejected; provider-required and cross-field constraints are enforced by Yandex.',
      inputSchema: { service: z.string(), method: z.string() },
      annotations: readAnnotations,
    },
    ({ service, method }) => wrap(() => describeMethod(service, method), false),
  );
  const callSchema = {
    service: z.string(),
    method: z.string(),
    request: z.record(z.unknown()).default({}),
  };
  server.registerTool(
    'yc_read',
    {
      description:
        'Execute a read-only Yandex Cloud method. Preserves pagination tokens; default pageSize 100. Secrets, VM metadata and binary payloads are redacted.',
      inputSchema: callSchema,
      annotations: readAnnotations,
    },
    ({ service, method, request }, extra) =>
      wrap(() => manager.call(service, method, request, false, extra.signal)),
  );
  server.registerTool(
    'yc_write',
    {
      description:
        'Manage Yandex Cloud resources (create/update/delete/start/stop/access bindings, etc.). Requires YC_ALLOW_WRITES=true. Can affect availability/cost/access. Async result is only submission; poll yc_wait_operation. No automatic mutation retry.',
      inputSchema: callSchema,
      annotations: writeAnnotations,
    },
    ({ service, method, request }, extra) =>
      wrap(() => manager.call(service, method, request, true, extra.signal)),
  );
  server.registerTool(
    'yc_wait_operation',
    {
      description:
        'Poll a submitted cloud operation with a bounded wait. Returns completed, failed or pending. Never repeats the mutation.',
      inputSchema: {
        operationId: z.string().min(1),
        timeoutMs: z.number().int().min(1000).max(120000).default(30000),
      },
      annotations: readAnnotations,
    },
    ({ operationId, timeoutMs }, extra) =>
      wrap(() => manager.waitOperation(operationId, timeoutMs, extra.signal)),
  );
  server.registerTool(
    'list_buckets',
    {
      description:
        'Legacy S3 bucket listing using YANDEX_ACCESS_KEY_ID/SECRET. Prefer yc_read storage.buckets.list for IAM-token authentication.',
      inputSchema: {},
      annotations: readAnnotations,
    },
    () => wrap(() => storage.listBuckets()),
  );
  server.registerTool(
    'list_objects',
    {
      description: 'List S3 objects, one page. Use returned nextToken as continuationToken.',
      inputSchema: {
        bucket: z.string().min(1),
        prefix: z.string().optional(),
        maxKeys: z.number().int().min(1).max(1000).default(100),
        continuationToken: z.string().optional(),
      },
      annotations: readAnnotations,
    },
    ({ bucket, prefix, maxKeys, continuationToken }) =>
      wrap(() => storage.listObjects(bucket, prefix, maxKeys, continuationToken)),
  );
  server.registerTool(
    'download_object',
    {
      description:
        'Download an S3 object (max 10 MiB) to a new filename under YC_DOWNLOAD_DIR. Writes only a local file; existing files are never overwritten.',
      inputSchema: {
        bucket: z.string().min(1),
        key: z.string().min(1),
        localPath: z.string().min(1),
      },
      annotations: { ...writeAnnotations, destructiveHint: false },
    },
    ({ bucket, key, localPath }) => wrap(() => storage.download(bucket, key, localPath)),
  );
  return server;
};
