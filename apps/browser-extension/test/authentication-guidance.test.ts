import { describe, expect, it } from 'vitest';

import { authenticationFailureMessage } from '../src/authentication-guidance.js';

describe('authentication guidance', () => {
  it('gives actionable bounded guidance without reflecting remote text', () => {
    expect(authenticationFailureMessage('oauth_authorization_cancelled')).toContain(
      'finish the district login',
    );
    expect(authenticationFailureMessage('oauth_authorization_page_unavailable')).toContain(
      'OAUTH-AUTHORIZATION-PAGE-UNAVAILABLE',
    );
    expect(authenticationFailureMessage('oauth_browser_identity_failed')).toContain(
      'OAUTH-BROWSER-IDENTITY-FAILED',
    );
    expect(authenticationFailureMessage('oauth_callback_invalid')).toContain('OAUTH-CALLBACK');
    expect(authenticationFailureMessage('oauth_invalid_grant')).toContain('OAUTH-TOKEN');
    expect(authenticationFailureMessage('oauth_server_error')).toContain('OAUTH-SERVER-ERROR');
    expect(authenticationFailureMessage('untrusted remote response with token=secret')).toBe(
      'AI Studio sign-in did not finish. Try again; if it repeats, contact district support. Support code: OAUTH-SIGNIN.',
    );
  });
});
