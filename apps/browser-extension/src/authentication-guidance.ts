export function authenticationFailureMessage(code: string): string {
  if (code === 'oauth_authorization_cancelled') {
    return 'Sign-in was closed before completion. Select Sign in to AI Studio and finish the district login.';
  }
  if (code === 'oauth_authorization_page_unavailable') {
    return 'The AI Studio sign-in page could not load. Check district network access and try again. Support code: OAUTH-AUTHORIZATION-PAGE-UNAVAILABLE.';
  }
  if (code === 'oauth_browser_identity_failed') {
    return 'AI Studio sign-in could not open in this browser. Retry in the district Chrome release; if it repeats, contact district support. Support code: OAUTH-BROWSER-IDENTITY-FAILED.';
  }
  if (
    code === 'oauth_callback_invalid' ||
    code === 'oauth_state_mismatch' ||
    code === 'oauth_authorization_response_invalid'
  ) {
    return 'AI Studio returned an invalid sign-in callback. Contact district support. Support code: OAUTH-CALLBACK.';
  }
  if (
    code === 'oauth_invalid_client' ||
    code === 'oauth_invalid_grant' ||
    code === 'oauth_request_failed' ||
    code === 'oauth_token_response_invalid'
  ) {
    return 'AI Studio accepted the login but could not create a usable session. Contact district support. Support code: OAUTH-TOKEN.';
  }
  if (/^oauth_[a-z0-9_]{1,100}$/.test(code)) {
    return `AI Studio sign-in did not finish. Try again; if it repeats, contact district support. Support code: ${code.toUpperCase().replaceAll('_', '-')}.`;
  }
  return 'AI Studio sign-in did not finish. Try again; if it repeats, contact district support. Support code: OAUTH-SIGNIN.';
}
