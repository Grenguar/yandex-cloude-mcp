#!/usr/bin/env node
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.local');
const option = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const profile = option('--profile');
if (!profile || profile.startsWith('-')) {
  console.error(
    'Usage: node scripts/configure-local.mjs --profile <yc-profile> [--use-profile-key] [--postbox-service-account-id <id>]',
  );
  process.exit(1);
}
await mkdir(dir, { recursive: true, mode: 0o700 });
await chmod(dir, 0o700);
try {
  await readFile(path.join(root, '.env'));
} catch {
  await writeFile(
    path.join(root, '.env'),
    `LOCAL_UID=${process.getuid?.() || 1000}\nLOCAL_GID=${process.getgid?.() || 1000}\n`,
    { mode: 0o600 },
  );
}
const yc = (args) =>
  execFileSync(process.env.YC_BINARY || 'yc', ['--profile', profile, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  }).trim();
const save = async (name, text) => {
  const temp = path.join(dir, name + '.' + randomBytes(4).toString('hex') + '.tmp');
  await writeFile(temp, text, { mode: 0o600 });
  await rename(temp, path.join(dir, name));
};
try {
  const folderId = yc(['config', 'get', 'folder-id']);
  if (!/^[a-zA-Z0-9-]+$/.test(folderId)) throw new Error('Missing folder');
  let authLine;
  if (process.argv.includes('--use-profile-key')) {
    const key = JSON.parse(yc(['config', 'get', 'service-account-key', '--format', 'json']));
    if (!key.id || !key.service_account_id || !key.private_key)
      throw new Error('Profile has no service-account key');
    await save('service-account-key.json', JSON.stringify(key));
    authLine = 'YC_SERVICE_ACCOUNT_KEY_FILE=/run/credentials/service-account-key.json';
  } else {
    await save('iam-token', yc(['iam', 'create-token']) + '\n');
    authLine = 'YC_IAM_TOKEN_FILE=/run/credentials/iam-token';
  }
  let httpToken;
  try {
    httpToken = (await readFile(path.join(dir, 'http-token'), 'utf8')).trim();
  } catch {
    httpToken = randomBytes(32).toString('hex');
  }
  await save('http-token', httpToken + '\n');
  let postbox = '';
  const serviceAccount = option('--postbox-service-account-id');
  if (serviceAccount) {
    await save(
      'postbox-token',
      yc(['iam', 'create-token', '--impersonate-service-account-id', serviceAccount]) + '\n',
    );
    postbox = 'YC_POSTBOX_IAM_TOKEN_FILE=/run/credentials/postbox-token\n';
  }
  // Preserve S3 credentials, timeouts and custom settings when refreshing auth.
  let previous = '';
  try {
    previous = await readFile(path.join(dir, 'server.env'), 'utf8');
  } catch {}
  const replaced = new Set([
    'YC_FOLDER_ID',
    'YC_IAM_TOKEN',
    'YC_IAM_TOKEN_FILE',
    'YC_SERVICE_ACCOUNT_KEY_FILE',
  ]);
  if (postbox) replaced.add('YC_POSTBOX_IAM_TOKEN_FILE');
  const preserved = previous
    .split('\n')
    .filter((line) => line && !replaced.has(line.split('=')[0]));
  if (!preserved.some((line) => line.startsWith('YC_ALLOW_WRITES=')))
    preserved.push('YC_ALLOW_WRITES=false');
  await save(
    'server.env',
    `YC_FOLDER_ID=${folderId}\n${authLine}\n${preserved.join('\n')}\n${postbox}`,
  );
  console.log(
    'Local credentials configured/refreshed without printing secrets. Start with docker compose up -d --build. Token-file mode needs refresh before expiry; key-file mode renews IAM tokens automatically.',
  );
} catch {
  console.error(
    'yc credential setup failed. Check profile authentication, folder-id and optional service-account impersonation permission. No token values were printed.',
  );
  process.exit(1);
}
