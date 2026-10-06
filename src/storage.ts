import { mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { InputError } from './catalog.js';
export class StorageTools {
  private client: S3Client;
  constructor(
    private env = process.env,
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        region: 'ru-central1',
        endpoint: 'https://storage.yandexcloud.net',
        forcePathStyle: true,
        credentials: {
          accessKeyId: env.YANDEX_ACCESS_KEY_ID || '',
          secretAccessKey: env.YANDEX_SECRET_ACCESS_KEY || '',
        },
        maxAttempts: 1,
      });
  }
  private check() {
    if (!this.env.YANDEX_ACCESS_KEY_ID || !this.env.YANDEX_SECRET_ACCESS_KEY)
      throw new InputError(
        'Legacy S3 object tools require YANDEX_ACCESS_KEY_ID and YANDEX_SECRET_ACCESS_KEY. Bucket management uses the Yandex SDK.',
      );
  }
  async listBuckets() {
    this.check();
    const r = await this.client.send(new ListBucketsCommand({}), {
      abortSignal: AbortSignal.timeout(30_000),
    });
    return { buckets: r.Buckets, nextToken: r.ContinuationToken };
  }
  async listObjects(bucket: string, prefix?: string, maxKeys = 100, continuationToken?: string) {
    this.check();
    const r = await this.client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
        ContinuationToken: continuationToken,
      }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
    return { objects: r.Contents, nextToken: r.NextContinuationToken, isTruncated: r.IsTruncated };
  }
  async download(bucket: string, key: string, localPath: string) {
    this.check();
    const root = this.env.YC_DOWNLOAD_DIR || '/downloads';
    // Only direct filenames are accepted; no symlinks or directory traversal.
    if (!localPath || path.basename(localPath) !== localPath || ['.', '..'].includes(localPath))
      throw new InputError(
        'localPath must be a filename within YC_DOWNLOAD_DIR, not an absolute path',
      );
    await mkdir(root, { recursive: true });
    const target = path.join(await realpath(root), localPath);
    const handle = await open(target, 'wx', 0o600);
    let size = 0;
    let success = false;
    const abort = new AbortController();
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]),
      });
      if ((result.ContentLength ?? 0) > 10 * 1024 * 1024)
        throw new InputError('Download exceeds 10 MiB');
      if (!result.Body) throw new InputError('Empty object response');
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > 10 * 1024 * 1024) throw new InputError('Download exceeds 10 MiB');
        await handle.writeFile(chunk);
      }
      success = true;
      return { path: target, bytes: size };
    } finally {
      abort.abort();
      await handle.close();
      if (!success) {
        const { unlink } = await import('node:fs/promises');
        await unlink(target);
      }
    }
  }
}
