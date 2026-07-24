const origin = 'https://aistudio.psd401.ai';
const expected = {
  authorization_endpoint: `${origin}/api/oauth/auth`,
  issuer: origin,
  revocation_endpoint: `${origin}/api/oauth/revocation`,
  token_endpoint: `${origin}/api/oauth/token`,
};
const requiredScopes = [
  'openid',
  'profile',
  'offline_access',
  'content:read',
  'content:create',
  'content:update',
  'content:publish_internal',
];
const registeredClients = [
  {
    clientId: process.env.ATRIUM_CAPTURE_BROWSER_OAUTH_CLIENT_ID,
    profile: 'browser_extension',
    redirectUri: 'https://jldnpmcpimhabiphcglkbgmbffpoocpo.chromiumapp.org/atrium',
  },
  {
    clientId: process.env.ATRIUM_CAPTURE_MAC_OAUTH_CLIENT_ID,
    profile: 'native',
    redirectUri: 'org.psd401.atrium-capture:/oauth/callback',
  },
];

const discoveryResponse = await fetch(`${origin}/.well-known/openid-configuration`, {
  headers: { accept: 'application/json', 'cache-control': 'no-store' },
});
const discovery = await boundedJson(discoveryResponse);
if (!discoveryResponse.ok || !discovery || typeof discovery !== 'object') {
  throw new Error('Atrium OIDC discovery is unavailable.');
}
for (const [key, value] of Object.entries(expected)) {
  if (discovery[key] !== value) {
    throw new Error(`Atrium OIDC discovery field ${key} differs from the reviewed contract.`);
  }
}
if (
  !Array.isArray(discovery.code_challenge_methods_supported) ||
  !discovery.code_challenge_methods_supported.includes('S256') ||
  !Array.isArray(discovery.scopes_supported) ||
  !requiredScopes.every((scope) => discovery.scopes_supported.includes(scope))
) {
  throw new Error('Atrium OIDC discovery lacks required PKCE or content capabilities.');
}

const boundaryResponse = await fetch(`${origin}/api/v1/content/collections?shape=flat`, {
  headers: { accept: 'application/json', 'cache-control': 'no-store' },
});
const boundary = await boundedJson(boundaryResponse);
if (
  boundaryResponse.status !== 401 ||
  !boundary ||
  typeof boundary !== 'object' ||
  boundary.error?.code !== 'UNAUTHORIZED' ||
  typeof boundary.requestId !== 'string'
) {
  throw new Error('Atrium content boundary did not fail closed with its documented 401 shape.');
}

const suppliedClients = registeredClients.filter(({ clientId }) => clientId !== undefined);
if (suppliedClients.length !== 0 && suppliedClients.length !== registeredClients.length) {
  throw new Error(
    'Supply both ATRIUM_CAPTURE_BROWSER_OAUTH_CLIENT_ID and ATRIUM_CAPTURE_MAC_OAUTH_CLIENT_ID.',
  );
}
const registrationResults = await Promise.allSettled(
  suppliedClients.map((registration) => verifyOAuthRegistration(registration)),
);
const registrationFailures = registrationResults.flatMap((result) =>
  result.status === 'rejected'
    ? [result.reason instanceof Error ? result.reason.message : 'Atrium registration check failed.']
    : [],
);
if (registrationFailures.length > 0) {
  throw new Error(registrationFailures.join(' '));
}

console.log(
  JSON.stringify({
    contentBoundary: 'documented_unauthenticated_401',
    issuer: discovery.issuer,
    oauth: 'authorization_code_s256_refresh',
    registeredClients: suppliedClients.map(({ profile }) => profile),
    status: 'pass',
  }),
);

async function verifyOAuthRegistration({ clientId, profile, redirectUri }) {
  if (!isUuid(clientId)) {
    throw new Error(`Atrium ${profile} OAuth client ID is not a UUID.`);
  }
  const authorizationUrl = new URL(expected.authorization_endpoint);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('scope', requiredScopes.join(' '));
  authorizationUrl.searchParams.set('state', 'synthetic-registration-check');
  authorizationUrl.searchParams.set(
    'code_challenge',
    '8ZvtqG4OYJB9z3AlY2_2Vg9OPbAdzXG6_HfV1x5Sg7g',
  );
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');

  const response = await fetch(authorizationUrl, {
    headers: { accept: 'text/html', 'cache-control': 'no-store' },
    redirect: 'manual',
  });
  if (response.status < 300 || response.status >= 400) {
    throw new Error(
      `Atrium ${profile} OAuth authorization returned HTTP ${response.status} instead of a redirect.`,
    );
  }
  const location = response.headers.get('location');
  if (!location) {
    throw new Error(`Atrium ${profile} OAuth registration did not start authorization.`);
  }
  const redirect = new URL(location, origin);
  const error = redirect.searchParams.get('error');
  if (error) {
    const scope = redirect.searchParams.get('scope');
    const scopeSuffix = scope ? ` for ${scope}` : '';
    throw new Error(`Atrium ${profile} OAuth registration returned ${error}${scopeSuffix}.`);
  }
}

function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

async function boundedJson(response) {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 1_000_000) {
    throw new Error('Atrium response exceeded the smoke-check limit.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Atrium returned a non-JSON response.');
  }
}
