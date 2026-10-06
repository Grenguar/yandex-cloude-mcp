import { createRequire } from 'node:module';
import path from 'node:path';
import { Session } from '@yandex-cloud/nodejs-sdk';
import type { TokenProvider } from './auth.js';
import type { Backend, Config, ServiceSpec } from './types.js';
const require = createRequire(import.meta.url);
const sdkRoot = path.dirname(require.resolve('@yandex-cloud/nodejs-sdk'));

export class SdkBackend implements Backend {
  private token?: string;
  private session?: Pick<Session, 'client'>;
  private clients = new Map<string, any>();
  constructor(
    private services: Record<string, ServiceSpec>,
    private auth: TokenProvider,
    private config: Config,
    private sessionFactory: (token: string) => Pick<Session, 'client'> = (token) =>
      new Session({ iamToken: token }),
  ) {}
  async call(
    service: string,
    method: string,
    request: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const spec = this.services[service]!;
    const methodSpec = spec.methods[method]!;
    const token = await this.auth.getToken();
    if (this.token !== token) {
      this.token = token;
      this.session = this.sessionFactory(token);
      this.clients.clear();
    }
    let client = this.clients.get(service);
    if (!client) {
      const mod = require(path.join(sdkRoot, spec.module!));
      client = this.session!.client(mod[spec.clientName!]);
      this.clients.set(service, client);
    }
    const codec = require(path.join(sdkRoot, methodSpec.requestModule!))[methodSpec.requestType!];
    return client[method](codec.fromJSON(request), {
      deadline: new Date(Date.now() + this.config.timeoutMs),
      signal,
      retry: false, // A timed-out mutation must never be blindly repeated.
    });
  }
}
