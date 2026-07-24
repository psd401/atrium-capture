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

console.log(
  JSON.stringify({
    contentBoundary: 'documented_unauthenticated_401',
    issuer: discovery.issuer,
    oauth: 'authorization_code_s256_refresh',
    status: 'pass',
  }),
);

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
