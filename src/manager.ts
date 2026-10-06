import { setTimeout as delay } from 'node:timers/promises';
import { getMethod, InputError, rootProperties, validateRequest } from './catalog.js';
import { redact, safeError, CloudApiError } from './redact.js';
import type { Backend, Config, JsonObject } from './types.js';
export class CloudManager {
  constructor(
    readonly config: Config,
    private sdk: Backend,
    private postbox: Backend,
  ) {}
  async call(
    service: string,
    method: string,
    input: JsonObject,
    write: boolean,
    signal?: AbortSignal,
  ) {
    const spec = getMethod(service, method);
    if (write && !this.config.allowWrites)
      throw new InputError(
        'Writes disabled. Set YC_ALLOW_WRITES=true on the server to enable management.',
      );
    if (spec.readOnly === write)
      throw new InputError(
        spec.readOnly
          ? 'Use yc_read for read-only methods'
          : 'This method mutates resources; use yc_write',
      );
    const request = { ...input };
    const props = rootProperties(spec);
    if (props.folderId && request.folderId === undefined && this.config.folderId)
      request.folderId = this.config.folderId;
    if (props.pageSize && request.pageSize === undefined) request.pageSize = 100;
    if (props.PageSize && request.PageSize === undefined) request.PageSize = 100;
    if (Buffer.byteLength(JSON.stringify(request)) > 1_000_000)
      throw new InputError('Request too large');
    validateRequest(service, method, request);
    try {
      const result = await (service === 'postbox' ? this.postbox : this.sdk).call(
        service,
        method,
        request,
        signal,
      );
      const clean = redact(result);
      if (Buffer.byteLength(JSON.stringify(clean)) > this.config.maxOutputBytes) {
        // Never truncate the middle of JSON or falsely report the provider call failed.
        return {
          outputOmitted: true,
          reason: 'Response exceeds output limit; reduce pageSize or request a specific resource.',
          operationId:
            typeof result === 'object' && result && 'done' in result && 'id' in result
              ? result.id
              : undefined,
        };
      }
      return clean;
    } catch (error) {
      throw new CloudApiError(safeError(error));
    }
  }
  async waitOperation(operationId: string, timeoutMs = 30_000, signal?: AbortSignal) {
    if (!operationId || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000)
      throw new InputError('Operation ID and timeout between 1000 and 120000 ms required');
    const end = Date.now() + timeoutMs;
    const bounded = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    const pending = () => ({
      status: 'pending',
      operationId,
      message: 'Completion not observed within the wait. Poll again; do not repeat the mutation.',
    });
    while (true) {
      let operation: JsonObject;
      try {
        operation = (await this.call(
          'operations',
          'get',
          { operationId },
          false,
          bounded,
        )) as JsonObject;
      } catch (error) {
        if (bounded.aborted && !signal?.aborted) return pending();
        throw error;
      }
      if (operation.done) return { status: operation.error ? 'failed' : 'completed', operation };
      if (Date.now() + 1000 >= end) return pending();
      try {
        await delay(1000, undefined, { signal: bounded });
      } catch (error) {
        if (bounded.aborted && !signal?.aborted) return pending();
        throw error;
      }
    }
  }
}
