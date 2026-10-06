import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostboxBackend } from '../src/postbox.js';
import { validateRequest } from '../src/catalog.js';
const config = { allowWrites: true, timeoutMs: 1000, maxOutputBytes: 1000 };
const token = {
  async getToken() {
    return 'test-token-not-a-credential';
  },
};
test('Postbox IAM auth, pagination and fixed endpoint are correct', async () => {
  let captured: { url: URL; options: RequestInit } | undefined;
  const fake = async (url: URL, options: RequestInit) => {
    captured = { url, options };
    return new Response(JSON.stringify({ EmailIdentities: [], NextToken: 'next' }));
  };
  const backend = new PostboxBackend(token, config, fake as typeof fetch);
  const result = await backend.call('postbox', 'listIdentities', {
    PageSize: 10,
    NextToken: 'a+b/=',
  });
  assert.equal(captured!.url.origin, 'https://postbox.cloud.yandex.net');
  assert.equal(captured!.url.pathname, '/v2/email/identities');
  assert.equal(captured!.url.searchParams.get('NextToken'), 'a+b/=');
  assert.equal(
    (captured!.options.headers as Record<string, string>)['X-YaCloud-SubjectToken'],
    'test-token-not-a-credential',
  );
  assert.equal(captured!.options.redirect, 'error');
  assert.deepEqual(result, { EmailIdentities: [], NextToken: 'next' });
});
test('Postbox mutation uses method-specific path/body and no arbitrary URLs', async () => {
  const seen: any[] = [];
  const backend = new PostboxBackend(token, config, (async (url: URL, options: RequestInit) => {
    seen.push({ url, options });
    return new Response('{}');
  }) as typeof fetch);
  await backend.call('postbox', 'updateDkim', {
    EmailIdentity: 'a/b.example',
    SigningEnabled: false,
  });
  assert.equal(seen[0].url.pathname, '/v2/email/identities/a%2Fb.example/dkim');
  assert.equal(seen[0].options.method, 'PUT');
  assert.deepEqual(JSON.parse(seen[0].options.body), { SigningEnabled: false });
  assert.throws(() =>
    validateRequest('postbox', 'updateDkim', { EmailIdentity: 'domain', SigningEnabled: 'false' }),
  );
  assert.throws(() =>
    validateRequest('postbox', 'listIdentities', { url: 'https://evil.example' }),
  );
  assert.throws(() => validateRequest('postbox', 'sendEmail', { FromEmailAddress: 'x' }));
});
test('Postbox provider errors and oversized streams are bounded', async () => {
  const failing = new PostboxBackend(
    token,
    config,
    (async () => new Response('private-token', { status: 403 })) as typeof fetch,
  );
  await assert.rejects(
    failing.call('postbox', 'listIdentities', {}),
    (e: any) => e.code === 403 && !e.message.includes('private-token'),
  );
  const huge = new PostboxBackend(
    token,
    config,
    (async () => new Response('x'.repeat(1500))) as typeof fetch,
  );
  await assert.rejects(huge.call('postbox', 'listIdentities', {}), /too large/);
});

test('Postbox event destination matches documented Kinesis fields and suppression filters repeat Reason', async () => {
  const calls: any[] = [];
  const backend = new PostboxBackend(token, config, (async (url: URL, options: RequestInit) => {
    calls.push({ url, options });
    return new Response('{}');
  }) as typeof fetch);
  const request = {
    ConfigurationSetName: 'test-config',
    EventDestinationName: 'test-stream',
    EventDestination: {
      Enabled: true,
      KinesisFirehoseDestination: { DeliveryStreamArn: 'arn:yc:yds:fixture' },
    },
    MatchingEventTypes: ['DELIVERY'],
  };
  validateRequest('postbox', 'createEventDestination', request);
  await backend.call('postbox', 'createEventDestination', request);
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.MatchingEventTypes, ['DELIVERY']);
  assert.equal(
    body.EventDestination.KinesisFirehoseDestination.DeliveryStreamArn,
    'arn:yc:yds:fixture',
  );
  assert.equal(body.ConfigurationSetName, undefined);
  await backend.call('postbox', 'listSuppressedDestinations', { Reason: ['BOUNCE', 'COMPLAINT'] });
  assert.deepEqual(calls[1].url.searchParams.getAll('Reason'), ['BOUNCE', 'COMPLAINT']);
});
