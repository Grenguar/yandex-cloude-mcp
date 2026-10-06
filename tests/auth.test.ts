import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTokenProvider } from '../src/auth.js';
test('explicit auth only; rotating token file is reread on every call', async () => {
  await assert.rejects(createTokenProvider({}).getToken(), /Configure/);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yc-auth-test-'));
  try {
    const file = path.join(dir, 'token');
    await writeFile(file, 'test-token-1\n', { mode: 0o600 });
    const provider = createTokenProvider({ YC_IAM_TOKEN_FILE: file });
    assert.equal(await provider.getToken(), 'test-token-1');
    await writeFile(file, 'test-token-2\n');
    assert.equal(await provider.getToken(), 'test-token-2');
  } finally {
    await rm(dir, { recursive: true });
  }
});
