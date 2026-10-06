export type JsonObject = Record<string, unknown>;
export type Schema = Record<string, any>;
export interface MethodSpec {
  readOnly: boolean;
  schema: Schema;
  description?: string;
  requestType?: string;
  requestModule?: string;
}
export interface ServiceSpec {
  module?: string;
  clientName?: string;
  methods: Record<string, MethodSpec>;
}
export interface Backend {
  call(
    service: string,
    method: string,
    request: JsonObject,
    signal?: AbortSignal,
  ): Promise<unknown>;
}
export interface Config {
  allowWrites: boolean;
  folderId?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}
export const readConfig = (env = process.env): Config => ({
  allowWrites: env.YC_ALLOW_WRITES === 'true',
  folderId: env.YC_FOLDER_ID || undefined,
  timeoutMs: bounded(env.YC_TIMEOUT_MS, 30_000, 1000, 120_000),
  maxOutputBytes: bounded(env.YC_MAX_OUTPUT_BYTES, 256_000, 1024, 2_000_000),
});
const bounded = (value: string | undefined, fallback: number, min: number, max: number) => {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`Configuration value must be an integer between ${min} and ${max}`);
  return n;
};
