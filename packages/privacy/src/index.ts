export type SourceUrlRetention = 'none' | 'origin' | 'full';

export interface FieldDescriptor {
  autocomplete?: string;
  inputMode?: string;
  role?: string;
  tagName: string;
  type?: string;
}

export interface CaptureSitePolicy {
  allowedOrigins?: readonly string[];
  deniedOrigins?: readonly string[];
}

export type FieldClassification =
  { capture: 'allow' } | { capture: 'deny'; reason: 'password' | 'credential_autocomplete' };

const blockedAutocompleteTokens = new Set([
  'cc-csc',
  'cc-number',
  'current-password',
  'new-password',
  'one-time-code',
]);

export function classifyField(descriptor: FieldDescriptor): FieldClassification {
  if (descriptor.type?.trim().toLowerCase() === 'password') {
    return { capture: 'deny', reason: 'password' };
  }

  const autocompleteTokens = descriptor.autocomplete?.toLowerCase().split(/\s+/) ?? [];
  if (autocompleteTokens.some((token) => blockedAutocompleteTokens.has(token))) {
    return { capture: 'deny', reason: 'credential_autocomplete' };
  }

  return { capture: 'allow' };
}

export function genericInputInstruction(accessibleName?: string): string {
  return accessibleName
    ? `Enter the requested value in ${accessibleName}.`
    : 'Enter the requested value.';
}

export function retainBrowserLocation(
  rawUrl: string,
  retention: SourceUrlRetention,
): { origin: string; path?: string } | undefined {
  if (retention === 'none') {
    return undefined;
  }

  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }

  if (retention === 'full') {
    return { origin: url.origin, path: url.pathname };
  }

  return { origin: url.origin };
}

function originMatches(origin: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const hostname = new URL(origin).hostname;
    const suffix = pattern.slice(2).toLowerCase();
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }

  return origin === pattern;
}

export function evaluateSiteAccess(
  rawUrl: string,
  policy: CaptureSitePolicy,
):
  | { allowed: true; origin: string }
  | { allowed: false; reason: 'scheme' | 'denied' | 'not_allowed' } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'scheme' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { allowed: false, reason: 'scheme' };
  }

  if (policy.deniedOrigins?.some((pattern) => originMatches(url.origin, pattern))) {
    return { allowed: false, reason: 'denied' };
  }

  if (
    policy.allowedOrigins &&
    !policy.allowedOrigins.some((pattern) => originMatches(url.origin, pattern))
  ) {
    return { allowed: false, reason: 'not_allowed' };
  }

  return { allowed: true, origin: url.origin };
}
