import { describe, expect, it } from 'vitest';

import {
  BrowserOAuthBroker,
  BrowserOAuthSession,
  BrowserTrustedTokenStore,
  parseTokenResponse,
  type OAuthTokenSet,
  type TrustedTokenStore,
} from '../src/browser-oauth.js';

describe('trusted browser OAuth broker', () => {
  it('uses Authorization Code with S256 PKCE and stores tokens only in the trusted store', async () => {
    let authorizationUrl = '';
    let saved: OAuthTokenSet | undefined;
    const store: TrustedTokenStore = {
      async clear() {
        saved = undefined;
      },
      async load() {
        return saved;
      },
      async save(tokens) {
        saved = tokens;
      },
    };
    const identity = {
      getRedirectURL: () => 'https://jldnpmcpimhabiphcglkbgmbffpoocpo.chromiumapp.org/atrium',
      async launchWebAuthFlow(details: { interactive: boolean; url: string }) {
        authorizationUrl = details.url;
        const state = new URL(details.url).searchParams.get('state');
        return `https://jldnpmcpimhabiphcglkbgmbffpoocpo.chromiumapp.org/atrium?code=synthetic-code&state=${state}`;
      },
    };
    const broker = new BrowserOAuthBroker(identity, store, () => 1_000);
    let exchangedVerifier = '';
    await broker.authorize(
      {
        authorizationEndpoint: 'https://login.example.test/authorize',
        clientId: 'synthetic-public-client',
        scopes: ['openid'],
      },
      async (request) => {
        exchangedVerifier = request.codeVerifier;
        expect(request.code).toBe('synthetic-code');
        return {
          access_token: 'synthetic-access-token',
          expires_in: 300,
          refresh_token: 'synthetic-refresh-token',
          token_type: 'Bearer',
        };
      },
    );

    const url = new URL(authorizationUrl);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.has('code_challenge')).toBe(true);
    expect(url.searchParams.has('code_verifier')).toBe(false);
    expect(exchangedVerifier.length).toBeGreaterThan(40);
    expect(saved).toEqual({
      accessToken: 'synthetic-access-token',
      clientId: 'synthetic-public-client',
      expiresAt: 301_000,
      refreshToken: 'synthetic-refresh-token',
      tokenType: 'Bearer',
    });
  });

  it('rejects malformed token responses at the trusted network boundary', () => {
    expect(() =>
      parseTokenResponse({ access_token: 'synthetic', expires_in: 300, token_type: 'bearer' }),
    ).toThrow('oauth_token_response_invalid');
    expect(() => parseTokenResponse({ access_token: 'synthetic' })).toThrow(
      'oauth_token_response_invalid',
    );
  });

  it('rejects an authorization response outside the exact Chrome callback', async () => {
    let saved: OAuthTokenSet | undefined;
    const broker = new BrowserOAuthBroker(
      {
        getRedirectURL: () => 'https://extension.example.test/atrium',
        async launchWebAuthFlow(details) {
          const state = new URL(details.url).searchParams.get('state');
          return `https://attacker.example.test/atrium?code=synthetic-code&state=${state}`;
        },
      },
      {
        async clear() {
          saved = undefined;
        },
        async load() {
          return saved;
        },
        async save(tokens) {
          saved = tokens;
        },
      },
    );

    await expect(
      broker.authorize(
        {
          authorizationEndpoint: 'https://login.example.test/authorize',
          clientId: 'synthetic-public-client',
          scopes: ['openid'],
        },
        async () => {
          throw new Error('exchange_must_not_run');
        },
      ),
    ).rejects.toThrow('oauth_callback_invalid');
    expect(saved).toBeUndefined();
  });

  it('refreshes once across concurrent callers, rotates tokens, and revokes on sign-out', async () => {
    let now = 1_000;
    let stored: OAuthTokenSet | undefined = {
      accessToken: 'expired-access',
      clientId: '70000000-0000-4000-8000-000000000001',
      expiresAt: 1_000,
      refreshToken: 'refresh-one',
      tokenType: 'Bearer',
    };
    const requests: Array<{ body: string; url: string }> = [];
    const session = new BrowserOAuthSession(
      {
        getRedirectURL: () => 'https://extension.example.test/atrium',
        async launchWebAuthFlow() {
          throw new Error('not_used');
        },
      },
      {
        async clear() {
          stored = undefined;
        },
        async load() {
          return stored;
        },
        async save(tokens) {
          stored = tokens;
        },
      },
      async () => ({
        authorizationEndpoint: 'https://aistudio.example.test/api/oauth/auth',
        clientId: '70000000-0000-4000-8000-000000000001',
        revocationEndpoint: 'https://aistudio.example.test/api/oauth/revocation',
        scopes: ['openid', 'offline_access'],
        tokenEndpoint: 'https://aistudio.example.test/api/oauth/token',
      }),
      async (input, init) => {
        requests.push({ body: String(init?.body), url: String(input) });
        if (String(input).endsWith('/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'fresh-access',
              expires_in: 300,
              refresh_token: 'refresh-two',
              token_type: 'Bearer',
            }),
            { status: 200 },
          );
        }
        return new Response(undefined, { status: 200 });
      },
      () => now,
    );

    await expect(Promise.all([session.accessToken(), session.accessToken()])).resolves.toEqual([
      'fresh-access',
      'fresh-access',
    ]);
    expect(requests.filter((request) => request.url.endsWith('/token'))).toHaveLength(1);
    expect(stored).toMatchObject({
      accessToken: 'fresh-access',
      refreshToken: 'refresh-two',
    });

    now += 1;
    await session.signOut();
    expect(stored).toBeUndefined();
    expect(requests.at(-1)).toMatchObject({
      body: expect.stringContaining('token=refresh-two'),
      url: 'https://aistudio.example.test/api/oauth/revocation',
    });
  });

  it('fails closed and clears stale tokens after a malformed refresh response', async () => {
    let stored: OAuthTokenSet | undefined = {
      accessToken: 'expired-access',
      clientId: '70000000-0000-4000-8000-000000000001',
      expiresAt: 1_000,
      refreshToken: 'refresh-one',
      tokenType: 'Bearer',
    };
    const session = new BrowserOAuthSession(
      {
        getRedirectURL: () => 'https://extension.example.test/atrium',
        async launchWebAuthFlow() {
          throw new Error('not_used');
        },
      },
      {
        async clear() {
          stored = undefined;
        },
        async load() {
          return stored;
        },
        async save(tokens) {
          stored = tokens;
        },
      },
      async () => ({
        authorizationEndpoint: 'https://aistudio.example.test/api/oauth/auth',
        clientId: '70000000-0000-4000-8000-000000000001',
        revocationEndpoint: 'https://aistudio.example.test/api/oauth/revocation',
        scopes: ['openid', 'offline_access'],
        tokenEndpoint: 'https://aistudio.example.test/api/oauth/token',
      }),
      async () =>
        new Response(JSON.stringify({ token_type: 'Bearer' }), {
          status: 200,
        }),
      () => 1_000,
    );

    await expect(session.accessToken()).rejects.toThrow('oauth_token_response_invalid');
    expect(stored).toBeUndefined();
    await expect(session.status()).resolves.toBe('signed_out');
  });

  it('validates persisted tokens and never exposes them as a storage key name', async () => {
    const values: Record<string, unknown> = {};
    const store = new BrowserTrustedTokenStore({
      async get(key) {
        return { [key]: values[key] };
      },
      async remove(key) {
        delete values[key];
      },
      async set(items) {
        Object.assign(values, items);
      },
    });
    await store.save({
      accessToken: 'synthetic-secret-access',
      clientId: 'synthetic-client',
      expiresAt: 10_000,
      tokenType: 'Bearer',
    });

    await expect(store.load()).resolves.toMatchObject({
      accessToken: 'synthetic-secret-access',
    });
    expect(Object.keys(values)).toEqual(['atriumOAuthTokens']);
    values.atriumOAuthTokens = { accessToken: 'truncated' };
    await expect(store.load()).rejects.toThrow('oauth_token_store_invalid');
  });
});
