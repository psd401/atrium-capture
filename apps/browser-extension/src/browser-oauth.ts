import {
  createPkceRequest,
  GatewayError,
  parseAuthorizationCallback,
  type PkceAuthorizationConfig,
} from '@atrium-capture/atrium-client';

const TOKEN_STORAGE_KEY = 'atriumOAuthTokens';
const MAX_OAUTH_RESPONSE_BYTES = 100_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;

export interface BrowserIdentityApi {
  getRedirectURL(path?: string): string;
  launchWebAuthFlow(details: { interactive: boolean; url: string }): Promise<string | undefined>;
}

export interface OAuthTokenSet {
  accessToken: string;
  clientId?: string;
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
    const redirectUri = this.identity.getRedirectURL('atrium');
    const request = await createPkceRequest({ ...config, redirectUri });
    let callbackUrl: string | undefined;
    try {
      callbackUrl = await this.identity.launchWebAuthFlow({
        interactive: true,
        url: request.authorizationUrl,
      });
    } catch (error) {
      throw new GatewayError(classifyBrowserIdentityError(error), false);
    }
    if (!callbackUrl) {
      throw new GatewayError('oauth_authorization_cancelled', false);
    }
    const expectedCallback = new URL(redirectUri);
    const actualCallback = new URL(callbackUrl);
    if (
      actualCallback.origin !== expectedCallback.origin ||
      actualCallback.pathname !== expectedCallback.pathname
    ) {
      throw new GatewayError('oauth_callback_invalid', false);
    }
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
    await this.tokens.save({ ...response, clientId: config.clientId });
  }
}

export function oauthSupportCode(error: unknown): string {
  return error instanceof GatewayError && /^oauth_[a-z0-9_]{1,100}$/.test(error.code)
    ? error.code
    : 'oauth_sign_in_failed';
}

function classifyBrowserIdentityError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (/(cancel|closed|denied|did not approve)/.test(message)) {
    return 'oauth_authorization_cancelled';
  }
  if (/(could not be loaded|failed to load|network|page unavailable)/.test(message)) {
    return 'oauth_authorization_page_unavailable';
  }
  return 'oauth_browser_identity_failed';
}

export interface BrowserAtriumOAuthConfig extends BrowserOAuthConfig {
  revocationEndpoint: string;
  tokenEndpoint: string;
}

export type AuthenticationStatus = 'signed_in' | 'signed_out' | 'unconfigured';

/**
 * Owns the complete public-client lifecycle in the MV3 service worker.
 * Only a bounded status crosses the runtime-message boundary.
 */
export class BrowserOAuthSession {
  private refreshInFlight: Promise<string> | undefined;

  constructor(
    private readonly identity: BrowserIdentityApi,
    private readonly tokens: TrustedTokenStore,
    private readonly loadConfig: () => Promise<BrowserAtriumOAuthConfig | undefined>,
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async accessToken(): Promise<string> {
    const config = await this.requireConfig();
    const tokens = await this.loadMatchingTokens(config.clientId);
    if (!tokens) {
      throw new GatewayError('oauth_sign_in_required', false);
    }
    if (tokens.expiresAt > this.now() + TOKEN_REFRESH_SKEW_MS) {
      return tokens.accessToken;
    }
    if (!tokens.refreshToken) {
      await this.tokens.clear();
      throw new GatewayError('oauth_sign_in_required', false);
    }
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refresh(config, tokens).finally(() => {
        this.refreshInFlight = undefined;
      });
    }
    return this.refreshInFlight;
  }

  async signIn(): Promise<void> {
    const config = await this.requireConfig();
    const broker = new BrowserOAuthBroker(this.identity, this.tokens, this.now);
    await broker.authorize(config, (request) =>
      this.exchangeToken(config.tokenEndpoint, {
        client_id: request.clientId,
        code: request.code,
        code_verifier: request.codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: request.redirectUri,
      }),
    );
  }

  async signOut(): Promise<void> {
    const config = await this.loadConfig();
    let current: OAuthTokenSet | undefined;
    try {
      current = await this.tokens.load();
    } catch {
      // Corrupt trusted storage fails closed to signed out.
    }
    await this.tokens.clear();
    if (!config || !current || current.clientId !== config.clientId) {
      return;
    }
    const token = current.refreshToken ?? current.accessToken;
    const tokenTypeHint = current.refreshToken ? 'refresh_token' : 'access_token';
    try {
      await postForm(
        config.revocationEndpoint,
        {
          client_id: config.clientId,
          token,
          token_type_hint: tokenTypeHint,
        },
        this.request,
        false,
      );
    } catch {
      // Local sign-out is authoritative for the client. Remote expiry/revocation
      // is best effort and no token or server response is logged.
    }
  }

  async status(): Promise<AuthenticationStatus> {
    const config = await this.loadConfig();
    if (!config) {
      return 'unconfigured';
    }
    const tokens = await this.loadMatchingTokens(config.clientId);
    if (!tokens) {
      return 'signed_out';
    }
    if (tokens.expiresAt <= this.now() && !tokens.refreshToken) {
      await this.tokens.clear();
      return 'signed_out';
    }
    return 'signed_in';
  }

  private async exchangeToken(endpoint: string, body: Record<string, string>): Promise<unknown> {
    return postForm(endpoint, body, this.request, true);
  }

  private async loadMatchingTokens(clientId: string): Promise<OAuthTokenSet | undefined> {
    let tokens: OAuthTokenSet | undefined;
    try {
      tokens = await this.tokens.load();
    } catch {
      await this.tokens.clear().catch(() => undefined);
      return undefined;
    }
    if (tokens && tokens.clientId !== clientId) {
      await this.tokens.clear();
      return undefined;
    }
    return tokens;
  }

  private async refresh(config: BrowserAtriumOAuthConfig, current: OAuthTokenSet): Promise<string> {
    const refreshToken = current.refreshToken;
    if (!refreshToken) {
      throw new GatewayError('oauth_sign_in_required', false);
    }
    try {
      const refreshed = parseTokenResponse(
        await this.exchangeToken(config.tokenEndpoint, {
          client_id: config.clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
        this.now(),
      );
      const next = {
        ...refreshed,
        clientId: config.clientId,
        refreshToken: refreshed.refreshToken ?? refreshToken,
      };
      await this.tokens.save(next);
      return next.accessToken;
    } catch (error) {
      if (
        error instanceof GatewayError &&
        (error.code === 'oauth_invalid_grant' || !error.retryable)
      ) {
        await this.tokens.clear();
      }
      throw error;
    }
  }

  private async requireConfig(): Promise<BrowserAtriumOAuthConfig> {
    const config = await this.loadConfig();
    if (!config) {
      throw new GatewayError('atrium_oauth_client_unconfigured', false);
    }
    return config;
  }
}

export interface TrustedStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  remove(key: string): Promise<void>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Chrome storage adapter used only after the area is restricted to trusted contexts. */
export class BrowserTrustedTokenStore implements TrustedTokenStore {
  constructor(
    private readonly storage: TrustedStorageArea,
    private readonly trustedContextsReady: Promise<void> = Promise.resolve(),
  ) {}

  async clear(): Promise<void> {
    await this.requireTrustedContexts();
    await this.storage.remove(TOKEN_STORAGE_KEY);
  }

  async load(): Promise<OAuthTokenSet | undefined> {
    await this.requireTrustedContexts();
    const value = (await this.storage.get(TOKEN_STORAGE_KEY))[TOKEN_STORAGE_KEY];
    return value === undefined ? undefined : parseStoredTokenSet(value);
  }

  async save(tokens: OAuthTokenSet): Promise<void> {
    await this.requireTrustedContexts();
    await this.storage.set({ [TOKEN_STORAGE_KEY]: tokens });
  }

  private async requireTrustedContexts(): Promise<void> {
    try {
      await this.trustedContextsReady;
    } catch {
      throw new GatewayError('oauth_token_store_unavailable', false);
    }
  }
}

export function parseTokenResponse(value: unknown, now = Date.now()): OAuthTokenSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GatewayError('oauth_token_response_invalid', false);
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
    /[\r\n]/.test(accessToken) ||
    tokenType !== 'Bearer' ||
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > 86_400 ||
    (refreshToken !== undefined &&
      (typeof refreshToken !== 'string' ||
        refreshToken.length === 0 ||
        refreshToken.length > 16_384 ||
        /[\r\n]/.test(refreshToken)))
  ) {
    throw new GatewayError('oauth_token_response_invalid', false);
  }
  return {
    accessToken,
    expiresAt: now + expiresIn * 1_000,
    tokenType,
    ...(typeof refreshToken === 'string' ? { refreshToken } : {}),
  };
}

function parseStoredTokenSet(value: unknown): OAuthTokenSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GatewayError('oauth_token_store_invalid', false);
  }
  const record = value as Record<string, unknown>;
  const accessToken = record.accessToken;
  const clientId = record.clientId;
  const expiresAt = record.expiresAt;
  const refreshToken = record.refreshToken;
  if (
    typeof accessToken !== 'string' ||
    accessToken.length === 0 ||
    accessToken.length > 16_384 ||
    /[\r\n]/.test(accessToken) ||
    typeof clientId !== 'string' ||
    clientId.length === 0 ||
    clientId.length > 500 ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt) ||
    record.tokenType !== 'Bearer' ||
    (refreshToken !== undefined &&
      (typeof refreshToken !== 'string' ||
        refreshToken.length === 0 ||
        refreshToken.length > 16_384 ||
        /[\r\n]/.test(refreshToken)))
  ) {
    throw new GatewayError('oauth_token_store_invalid', false);
  }
  return {
    accessToken,
    clientId,
    expiresAt,
    tokenType: 'Bearer',
    ...(typeof refreshToken === 'string' ? { refreshToken } : {}),
  };
}

async function postForm(
  endpoint: string,
  body: Record<string, string>,
  request: typeof fetch,
  expectJson: boolean,
): Promise<unknown> {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new GatewayError('oauth_endpoint_invalid', false);
  }
  let response: Response;
  try {
    response = await request(url, {
      body: new URLSearchParams(body),
      headers: {
        accept: 'application/json',
        'cache-control': 'no-store',
        'content-type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });
  } catch {
    throw new GatewayError('oauth_network_error', true);
  }
  const text = await response.text();
  if (text.length > MAX_OAUTH_RESPONSE_BYTES) {
    throw new GatewayError('oauth_response_too_large', false);
  }
  if (!response.ok) {
    let code = 'oauth_request_failed';
    try {
      const parsed = JSON.parse(text) as { error?: unknown; error_description?: unknown };
      if (typeof parsed.error === 'string' && /^[a-z0-9_]{1,100}$/i.test(parsed.error)) {
        code = `oauth_${parsed.error.toLowerCase()}`;
        if (parsed.error.toLowerCase() === 'invalid_request') {
          code = classifyInvalidRequestDescription(parsed.error_description);
        }
      }
    } catch {
      // Keep the bounded generic error. Response bodies never enter logs.
    }
    throw new GatewayError(
      code,
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
  if (!expectJson) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GatewayError('oauth_token_response_invalid', false);
  }
}

export function classifyInvalidRequestDescription(description: unknown): string {
  if (typeof description !== 'string') {
    return 'oauth_invalid_request';
  }
  const normalized = description.toLowerCase();
  const categories: ReadonlyArray<[RegExp, string]> = [
    [/\borigin\b|\bcors\b/, 'origin'],
    [/\bclient[_ -]?id\b|\bclient authentication\b/, 'client_id'],
    [/\bredirect[_ -]?uri\b/, 'redirect_uri'],
    [/\bcode[_ -]?verifier\b|\bpkce\b/, 'pkce_verifier'],
    [/\bauthorization code\b|\bcode parameter\b/, 'authorization_code'],
    [/\bgrant[_ -]?type\b/, 'grant_type'],
    [/\bresource\b|\baudience\b/, 'resource'],
    [/\bform\b|\brequest body\b|\bcontent[_ -]?type\b/, 'request_body'],
  ];
  const category = categories.find(([pattern]) => pattern.test(normalized))?.[1];
  return category ? `oauth_invalid_request_${category}` : 'oauth_invalid_request';
}
