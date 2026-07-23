import { describe, expect, it } from 'vitest';

import {
  BrowserOAuthBroker,
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
      getRedirectURL: () => 'https://jldnpmcpimhabiphcglkbgmbffpoocpo.chromiumapp.org/atrium-oauth',
      async launchWebAuthFlow(details: { interactive: boolean; url: string }) {
        authorizationUrl = details.url;
        const state = new URL(details.url).searchParams.get('state');
        return `https://jldnpmcpimhabiphcglkbgmbffpoocpo.chromiumapp.org/atrium-oauth?code=synthetic-code&state=${state}`;
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
});
