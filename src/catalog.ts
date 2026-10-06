import { readFileSync } from 'node:fs';
import { Ajv, type ValidateFunction } from 'ajv';
import { postboxRoutes } from './postbox.js';
import type { JsonObject, MethodSpec, Schema, ServiceSpec } from './types.js';
const data = JSON.parse(
  readFileSync(new URL('./generated/catalog.json', import.meta.url), 'utf8'),
) as {
  sdkVersion: string;
  services: Record<string, ServiceSpec>;
  definitions: Record<string, Schema>;
};
export const sdkServices = data.services;
export const services: Record<string, ServiceSpec> = {
  ...sdkServices,
  postbox: { methods: postboxRoutes },
};
const ajv = new Ajv({ strict: false, allErrors: true, ownProperties: true });
ajv.addSchema({ $id: 'yc-sdk', $defs: data.definitions });
const validators = new Map<string, ValidateFunction>();
export class InputError extends Error {}
export const getMethod = (service: string, method: string): MethodSpec => {
  if (!Object.hasOwn(services, service) || !Object.hasOwn(services[service]!.methods, method))
    throw new InputError('Unknown service/method; use yc_services and yc_describe first');
  return services[service]!.methods[method]!;
};
export const describeMethod = (service: string, method: string) => {
  const spec = getMethod(service, method);
  const definitions: Record<string, Schema> = {};
  const visit = (schema: unknown) => {
    if (!schema || typeof schema !== 'object') return;
    if ('$ref' in schema && typeof schema.$ref === 'string') {
      const key = schema.$ref.replace('#/$defs/', '');
      if (!definitions[key]) {
        definitions[key] = data.definitions[key]!;
        visit(definitions[key]);
      }
    }
    for (const value of Object.values(schema)) if (typeof value === 'object') visit(value);
  };
  visit(spec.schema);
  return {
    service,
    method,
    readOnly: spec.readOnly,
    description: spec.description,
    inputSchema: {
      ...spec.schema,
      ...(Object.keys(definitions).length ? { $defs: definitions } : {}),
    },
    notes:
      'SDK request fields use camelCase; Postbox uses PascalCase. Omitted protobuf fields use API defaults. Cloud-side required-field and cross-field rules still apply. Supply updateMask for updates. Async writes return operation IDs; poll before claiming completion. SDK numeric fields are limited to JavaScript safe integers.',
  };
};
export const rootProperties = (spec: MethodSpec): Record<string, Schema> => {
  const schema = spec.schema.$ref
    ? data.definitions[spec.schema.$ref.replace('#/$defs/', '')]!
    : spec.schema;
  return schema.properties ?? {};
};
const assertSafeKeys = (value: unknown, depth = 0) => {
  if (depth > 40) throw new InputError('Request nesting exceeds 40 levels');
  if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw new InputError('Invalid request property');
      assertSafeKeys(item, depth + 1);
    }
};
export const validateRequest = (service: string, method: string, request: JsonObject) => {
  assertSafeKeys(request);
  const spec = getMethod(service, method);
  const key = `${service}.${method}`;
  let validator = validators.get(key);
  if (!validator) {
    validator = ajv.compile(spec.schema.$ref ? { $ref: `yc-sdk${spec.schema.$ref}` } : spec.schema);
    validators.set(key, validator);
  }
  if (!validator(request))
    throw new InputError(
      'Invalid request: ' +
        validator.errors
          ?.slice(0, 5)
          .map((e) => `${e.instancePath || '/'} ${e.message}`)
          .join('; '),
    );
};
