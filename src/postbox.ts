import type { Backend, JsonObject, MethodSpec, Schema, Config } from './types.js';
import type { TokenProvider } from './auth.js';
const str = { type: 'string', minLength: 1 };
const bool = { type: 'boolean' };
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const page = { PageSize: { type: 'integer', minimum: 1, maximum: 1000 }, NextToken: str };
const identity = { EmailIdentity: str };
const configuration = { ConfigurationSetName: str };
interface Route extends MethodSpec {
  verb: string;
  path: string;
  query?: string[];
}
const route = (verb: string, path: string, schema: Schema, query?: string[]): Route => ({
  verb,
  path,
  schema,
  readOnly: verb === 'GET',
  query,
});
const email = obj({ EmailAddress: str }, ['EmailAddress']);
const destination = obj({
  ToAddresses: { type: 'array', items: str, minItems: 1, maxItems: 50 },
  CcAddresses: { type: 'array', items: str, maxItems: 50 },
  BccAddresses: { type: 'array', items: str, maxItems: 50 },
});
const content = obj({ Data: str, Charset: str }, ['Data']);
const eventDestination = obj(
  {
    Enabled: bool,
    KinesisFirehoseDestination: obj({ IamRoleArn: { type: 'string' }, DeliveryStreamArn: str }, [
      'DeliveryStreamArn',
    ]),
  },
  ['Enabled', 'KinesisFirehoseDestination'],
);
/** Paths and casing match Yandex's documented SES v2-compatible API. No arbitrary URL input. */
export const postboxRoutes: Record<string, Route> = {
  listIdentities: route('GET', '/identities', obj(page), ['PageSize', 'NextToken']),
  getIdentity: route('GET', '/identities/:EmailIdentity', obj(identity, ['EmailIdentity'])),
  createIdentity: route(
    'POST',
    '/identities',
    obj({ ...identity, ConfigurationSetName: str }, ['EmailIdentity']),
  ),
  deleteIdentity: route('DELETE', '/identities/:EmailIdentity', obj(identity, ['EmailIdentity'])),
  updateDkim: route(
    'PUT',
    '/identities/:EmailIdentity/dkim',
    obj({ ...identity, SigningEnabled: bool }, ['EmailIdentity', 'SigningEnabled']),
  ),
  setIdentityConfigurationSet: route(
    'PUT',
    '/identities/:EmailIdentity/configuration-set',
    obj({ ...identity, ...configuration }, ['EmailIdentity', 'ConfigurationSetName']),
  ),
  listConfigurationSets: route('GET', '/configuration-sets', obj(page), ['PageSize', 'NextToken']),
  getConfigurationSet: route(
    'GET',
    '/configuration-sets/:ConfigurationSetName',
    obj(configuration, ['ConfigurationSetName']),
  ),
  createConfigurationSet: route(
    'POST',
    '/configuration-sets',
    obj(configuration, ['ConfigurationSetName']),
  ),
  deleteConfigurationSet: route(
    'DELETE',
    '/configuration-sets/:ConfigurationSetName',
    obj(configuration, ['ConfigurationSetName']),
  ),
  putDeliveryOptions: route(
    'PUT',
    '/configuration-sets/:ConfigurationSetName/delivery-options',
    obj({ ...configuration, TlsPolicy: { enum: ['REQUIRE', 'OPTIONAL'] } }, [
      'ConfigurationSetName',
      'TlsPolicy',
    ]),
  ),
  putSuppressionOptions: route(
    'PUT',
    '/configuration-sets/:ConfigurationSetName/suppression-options',
    obj(
      {
        ...configuration,
        SuppressedReasons: { type: 'array', items: { enum: ['BOUNCE', 'COMPLAINT'] } },
      },
      ['ConfigurationSetName', 'SuppressedReasons'],
    ),
  ),
  listSuppressedDestinations: route(
    'GET',
    '/suppression/addresses',
    obj({
      ...page,
      StartDate: str,
      EndDate: str,
      Reason: { type: 'array', items: { enum: ['BOUNCE', 'COMPLAINT'] }, maxItems: 2 },
    }),
    ['PageSize', 'NextToken', 'StartDate', 'EndDate', 'Reason'],
  ),
  getSuppressedDestination: route('GET', '/suppression/addresses/:EmailAddress', email),
  putSuppressedDestination: route(
    'PUT',
    '/suppression/addresses',
    obj({ EmailAddress: str, Reason: { enum: ['BOUNCE', 'COMPLAINT'] } }, [
      'EmailAddress',
      'Reason',
    ]),
  ),
  deleteSuppressedDestination: route('DELETE', '/suppression/addresses/:EmailAddress', email),
  getEventDestinations: route(
    'GET',
    '/configuration-sets/:ConfigurationSetName/event-destinations',
    obj(configuration, ['ConfigurationSetName']),
  ),
  createEventDestination: route(
    'POST',
    '/configuration-sets/:ConfigurationSetName/event-destinations',
    obj(
      {
        ...configuration,
        EventDestinationName: str,
        EventDestination: eventDestination,
        MatchingEventTypes: {
          type: 'array',
          items: {
            enum: ['SEND', 'BOUNCE', 'SUBSCRIPTION', 'DELIVERY', 'DELIVERY_DELAY', 'OPEN', 'CLICK'],
          },
          minItems: 1,
        },
      },
      ['ConfigurationSetName', 'EventDestinationName', 'EventDestination', 'MatchingEventTypes'],
    ),
  ),
  updateEventDestination: route(
    'PUT',
    '/configuration-sets/:ConfigurationSetName/event-destinations/:EventDestinationName',
    obj(
      {
        ...configuration,
        EventDestinationName: str,
        EventDestination: eventDestination,
        MatchingEventTypes: {
          type: 'array',
          items: {
            enum: ['SEND', 'BOUNCE', 'SUBSCRIPTION', 'DELIVERY', 'DELIVERY_DELAY', 'OPEN', 'CLICK'],
          },
          minItems: 1,
        },
      },
      ['ConfigurationSetName', 'EventDestinationName', 'EventDestination', 'MatchingEventTypes'],
    ),
  ),
  deleteEventDestination: route(
    'DELETE',
    '/configuration-sets/:ConfigurationSetName/event-destinations/:EventDestinationName',
    obj({ ...configuration, EventDestinationName: str }, [
      'ConfigurationSetName',
      'EventDestinationName',
    ]),
  ),
  sendEmail: route(
    'POST',
    '/outbound-emails',
    obj(
      {
        FromEmailAddress: str,
        Destination: destination,
        Content: obj(
          {
            Simple: obj({ Subject: content, Body: obj({ Text: content, Html: content }) }, [
              'Subject',
              'Body',
            ]),
          },
          ['Simple'],
        ),
        ConfigurationSetName: str,
      },
      ['FromEmailAddress', 'Destination', 'Content'],
    ),
  ),
};
export class PostboxBackend implements Backend {
  constructor(
    private auth: TokenProvider,
    private config: Config,
    private fetcher: typeof fetch = fetch,
  ) {}
  async call(_service: string, method: string, request: JsonObject, signal?: AbortSignal) {
    const route = postboxRoutes[method]!;
    const body = { ...request };
    const path = route.path.replace(/:([A-Za-z]+)/g, (_match, key: string) => {
      const value = String(body[key]);
      delete body[key];
      return encodeURIComponent(value);
    });
    const url = new URL(`https://postbox.cloud.yandex.net/v2/email${path}`);
    for (const key of route.query ?? [])
      if (body[key] !== undefined) {
        for (const item of Array.isArray(body[key]) ? (body[key] as unknown[]) : [body[key]])
          url.searchParams.append(key, String(item));
        delete body[key];
      }
    const response = await this.fetcher(url, {
      method: route.verb,
      headers: {
        'X-YaCloud-SubjectToken': await this.auth.getToken(),
        'Content-Type': 'application/json',
      },
      body: ['GET', 'DELETE'].includes(route.verb) ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)])
        : AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error('Postbox failed'), { code: response.status });
    }
    const reader = response.body?.getReader();
    if (!reader) return {};
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > this.config.maxOutputBytes) throw new Error('Response too large');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : {};
  }
}
