import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import { StorageTools } from '../src/storage.js';
const env = { YANDEX_ACCESS_KEY_ID: 'test-id', YANDEX_SECRET_ACCESS_KEY: 'test-secret' };
test('S3 listing passes pagination parameters and returns continuation tokens', async () => {
  let input: unknown;
  const client = {
    send: async (command: any) => {
      input = command.input;
      return { Contents: [], NextContinuationToken: 'page2', IsTruncated: true };
    },
  } as unknown as S3Client;
  const storage = new StorageTools(env, client);
  assert.deepEqual(await storage.listObjects('bucket', 'prefix/', 25, 'page1'), {
    objects: [],
    nextToken: 'page2',
    isTruncated: true,
  });
  assert.deepEqual(input, {
    Bucket: 'bucket',
    Prefix: 'prefix/',
    MaxKeys: 25,
    ContinuationToken: 'page1',
  });
  await assert.rejects(new StorageTools({}).listBuckets(), /require/);
});
test('download streams bounded content, rejects traversal, symlinks and overwrite', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcp-download-'));
  const client = {
    send: async () => ({ Body: Readable.from([Buffer.from('hello'), Buffer.from(' world')]) }),
  } as unknown as S3Client;
  const storage = new StorageTools({ ...env, YC_DOWNLOAD_DIR: dir }, client);
  try {
    await assert.rejects(storage.download('b', 'k', '../escape'), /filename/);
    await assert.rejects(storage.download('b', 'k', '/tmp/escape'), /filename/);
    await writeFile(path.join(dir, 'existing'), 'untouched');
    await symlink(path.join(dir, 'existing'), path.join(dir, 'link'));
    await assert.rejects(storage.download('b', 'k', 'existing'));
    await assert.rejects(storage.download('b', 'k', 'link'));
    assert.equal(await readFile(path.join(dir, 'existing'), 'utf8'), 'untouched');
    assert.equal((await storage.download('b', 'k', 'new')).bytes, 11);
    assert.equal(await readFile(path.join(dir, 'new'), 'utf8'), 'hello world');
  } finally {
    await rm(dir, { recursive: true });
  }
});
test('oversized unknown-length downloads are aborted and partial files removed', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcp-large-'));
  const client = {
    send: async () => ({
      Body: Readable.from([Buffer.alloc(6 * 1024 * 1024), Buffer.alloc(6 * 1024 * 1024)]),
    }),
  } as unknown as S3Client;
  try {
    await assert.rejects(
      new StorageTools({ ...env, YC_DOWNLOAD_DIR: dir }, client).download('b', 'k', 'large'),
      /10 MiB/,
    );
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true });
  }
});
