const origin = 'https://aistudio.psd401.ai';
const extensionId = 'eomlblaiglafndhplfhilmdcaofhkkbj';
const extensionOrigin = `chrome-extension://${extensionId}`;
const clientId = 'ae781263-20c0-4b0c-8a34-8be01ab72fb1';
const redirectUri = `https://${extensionId}.chromiumapp.org/atrium`;

const response = await fetch(`${origin}/api/oauth/token`, {
  body: new URLSearchParams({
    client_id: clientId,
    code: 'synthetic-invalid-code',
    code_verifier: 'a'.repeat(43),
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  }),
  headers: {
    accept: 'application/json',
    'cache-control': 'no-store',
    'content-type': 'application/x-www-form-urlencoded',
    origin: extensionOrigin,
  },
  method: 'POST',
});
const payload = await boundedJson(response);
const error = typeof payload?.error === 'string' ? payload.error : 'invalid_response';
const category = invalidRequestCategory(payload?.error_description);

if (response.status === 400 && error === 'invalid_grant') {
  console.log(
    JSON.stringify({
      boundary: 'browser_extension_token_cors',
      syntheticCodeRejected: true,
      status: 'pass',
    }),
  );
} else {
  console.error(
    JSON.stringify({
      boundary: 'browser_extension_token_cors',
      observed: error === 'invalid_request' ? `invalid_request_${category}` : error,
      status: 'blocked',
      syntheticCodeRejected: false,
    }),
  );
  process.exitCode = 1;
}

async function boundedJson(fetchResponse) {
  const text = await fetchResponse.text();
  if (new TextEncoder().encode(text).byteLength > 100_000) {
    return undefined;
  }
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function invalidRequestCategory(description) {
  if (typeof description !== 'string') {
    return 'unspecified';
  }
  const normalized = description.toLowerCase();
  if (/\borigin\b|\bcors\b/.test(normalized)) {
    return 'origin';
  }
  if (/\brequest body\b|\bcontent[_ -]?type\b|\bform\b/.test(normalized)) {
    return 'request_body';
  }
  return 'other';
}
