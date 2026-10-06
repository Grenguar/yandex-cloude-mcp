const secretField =
  /^(?:private_?key|secret(?:_?access)?_?key|access_?token|refresh_?token|iam_?token|api_?key|password|passwd|authorization|cookie|textValue|binaryValue|payload|userData|user-data|metadata|environment|environmentVariables)$/i;
/** Metadata/cloud-init and opaque protobuf Any bytes may contain credentials. */
export const redact = (value: unknown): unknown => {
  if (value instanceof Uint8Array) return '[REDACTED BINARY]';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        secretField.test(key) ? '[REDACTED]' : redact(item),
      ]),
    );
  }
  if (typeof value === 'string')
    return value
      .replace(
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
        '[REDACTED]',
      )
      .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, '$1[REDACTED]@');
  return value;
};
export const safeError = (error: unknown) => {
  const code =
    error && typeof error === 'object' ? (error as Record<string, unknown>).code : undefined;
  // Provider error bodies can echo request secrets. Return only a stable code.
  return `Cloud API request failed${typeof code === 'number' || (typeof code === 'string' && /^[A-Z_0-9]+$/.test(code)) ? ` (${code})` : ''}. Check credentials, permissions, request fields and resource state. A timed-out write may still be running; inspect operations before retrying.`;
};

export class CloudApiError extends Error {}
