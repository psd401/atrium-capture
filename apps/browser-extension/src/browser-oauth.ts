import {
  createPkceRequest,
  parseAuthorizationCallback,
  type PkceAuthorizationConfig,
} from '@atrium-capture/atrium-client';

export interface BrowserIdentityApi {
  getRedirectURL(path?: string): string;
  launchWebAuthFlow(details: { interactive: boolean; url: string }): Promise<string>;
}

export interface OAuthTokenSet {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  tokenType: 'Bearer';
}

export interface TrustedTokenStore {
  clear(): Promise<void>;
  load(): Promise<OAuthTokenSet | undefined>;
  save(tokens: OAuthTokenSet): Promise<void>;
}

export interface AuthorizationCodeExchange {
  (request: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<unknown>;
}

export type BrowserOAuthConfig = Omit<PkceAuthorizationConfig, 'redirectUri'>;

/** Runs only in a trusted extension context; tokens are never returned through runtime messages. */
export class BrowserOAuthBroker {
  constructor(
    private readonly identity: BrowserIdentityApi,
    private readonly tokens: TrustedTokenStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async authorize(config: BrowserOAuthConfig, exchange: AuthorizationCodeExchange): Promise<void> {
    const redirectUri = this.identity.getRedirectURL('atrium-oauth');
    const request = await createPkceRequest({ ...config, redirectUri });
    const callbackUrl = await this.identity.launchWebAuthFlow({
      interactive: true,
      url: request.authorizationUrl,
    });
    const code = parseAuthorizationCallback(callbackUrl, request.state);
    const response = parseTokenResponse(
      await exchange({
        clientId: config.clientId,
        code,
        codeVerifier: request.codeVerifier,
        redirectUri,
      }),
      this.now(),
    );
    await this.tokens.save(response);
  }
}

export function parseTokenResponse(value: unknown, now = Date.now()): OAuthTokenSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('oauth_token_response_invalid');
  }
  const record = value as Record<string, unknown>;
  const accessToken = record.access_token;
  const tokenType = record.token_type;
  const expiresIn = record.expires_in;
  const refreshToken = record.refresh_token;
  if (
    typeof accessToken !== 'string' ||
    accessToken.length === 0 ||
    accessToken.length > 16_384 ||
    tokenType !== 'Bearer' ||
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > 86_400 ||
    (refreshToken !== undefined &&
      (typeof refreshToken !== 'string' ||
        refreshToken.length === 0 ||
        refreshToken.length > 16_384))
  ) {
    throw new Error('oauth_token_response_invalid');
  }
  return {
    accessToken,
    expiresAt: now + expiresIn * 1_000,
    tokenType,
    ...(typeof refreshToken === 'string' ? { refreshToken } : {}),
  };
}
