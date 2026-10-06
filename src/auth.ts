import { readFile } from 'node:fs/promises';
import { IamTokenService } from '@yandex-cloud/nodejs-sdk/dist/token-service/iam-token-service';

export interface TokenProvider {
  getToken(): Promise<string>;
}
/** Explicit credentials only. Never probe metadata or silently use an AWS profile. */
export const createTokenProvider = (env = process.env): TokenProvider => {
  let service: IamTokenService | undefined;
  return {
    async getToken() {
      if (env.YC_IAM_TOKEN_FILE) {
        const token = (await readFile(env.YC_IAM_TOKEN_FILE, 'utf8')).trim();
        if (!token) throw new Error('YC_IAM_TOKEN_FILE is empty');
        return token;
      }
      if (env.YC_IAM_TOKEN) return env.YC_IAM_TOKEN;
      if (env.YC_SERVICE_ACCOUNT_KEY_FILE) {
        if (!service) {
          const key = JSON.parse(await readFile(env.YC_SERVICE_ACCOUNT_KEY_FILE, 'utf8'));
          if (!key.id || !key.service_account_id || !key.private_key)
            throw new Error('Invalid service-account key file');
          service = new IamTokenService({
            accessKeyId: key.id,
            serviceAccountId: key.service_account_id,
            privateKey: key.private_key,
          });
        }
        return service.getToken();
      }
      throw new Error('Configure YC_IAM_TOKEN_FILE, YC_IAM_TOKEN or YC_SERVICE_ACCOUNT_KEY_FILE');
    },
  };
};
