import type { CaptureSitePolicy, SourceUrlRetention } from '@atrium-capture/privacy';

import type { RawImageRetention } from './database.js';

export const MANAGED_POLICY_SCHEMA_VERSION = 1;
export const DEFAULT_MAX_STORAGE_BYTES = 512 * 1024 * 1024;
export const DEFAULT_MAX_SESSION_STEPS = 1_000;

export interface RuntimeManagedPolicy extends CaptureSitePolicy {
  defaultCollectionId?: string;
  maxSessionSteps: number;
  maxStorageBytes: number;
  policyVersion: string;
  rawImageRetention: RawImageRetention;
  sourceUrlRetention: SourceUrlRetention;
}

export interface ManagedPolicySnapshot {
  configured: boolean;
  issues: string[];
  policy: RuntimeManagedPolicy;
  valid: boolean;
}

export interface ManagedStorageArea {
  get(keys?: null): Promise<Record<string, unknown>>;
}

const allowedKeys = new Set([
  'allowedOrigins',
  'defaultCollectionId',
  'deniedOrigins',
  'maxSessionSteps',
  'maxStorageBytes',
  'rawImageRetention',
  'schemaVersion',
  'sourceUrlRetention',
]);

const defaults: RuntimeManagedPolicy = {
  maxSessionSteps: DEFAULT_MAX_SESSION_STEPS,
  maxStorageBytes: DEFAULT_MAX_STORAGE_BYTES,
  policyVersion: 'local-default-v1',
  rawImageRetention: 'delete_after_flatten',
  sourceUrlRetention: 'origin',
};

export class ManagedPolicyProvider {
  constructor(private readonly storage: ManagedStorageArea) {}

  async load(): Promise<ManagedPolicySnapshot> {
    try {
      return parseManagedPolicy(await this.storage.get(null));
    } catch {
      return invalidPolicy(['managed_storage_unavailable']);
    }
  }
}

export function parseManagedPolicy(value: unknown): ManagedPolicySnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidPolicy(['managed_policy_not_an_object']);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return { configured: false, issues: [], policy: { ...defaults }, valid: true };
  }

  const issues: string[] = [];
  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      issues.push(`unknown_key:${key}`);
    }
  }
  if (record.schemaVersion !== MANAGED_POLICY_SCHEMA_VERSION) {
    issues.push('schema_version_invalid');
  }
  const allowedOrigins = parseOrigins(record.allowedOrigins, 'allowedOrigins', issues);
  const deniedOrigins = parseOrigins(record.deniedOrigins, 'deniedOrigins', issues);
  const sourceUrlRetention = parseEnum(
    record.sourceUrlRetention,
    ['none', 'origin', 'full'] as const,
    defaults.sourceUrlRetention,
    'source_url_retention_invalid',
    issues,
  );
  const rawImageRetention = parseEnum(
    record.rawImageRetention,
    ['delete_after_flatten', 'delete_after_submit'] as const,
    defaults.rawImageRetention,
    'raw_image_retention_invalid',
    issues,
  );
  const maxStorageBytes = parseInteger(
    record.maxStorageBytes,
    DEFAULT_MAX_STORAGE_BYTES,
    16 * 1024 * 1024,
    4 * 1024 * 1024 * 1024,
    'max_storage_bytes_invalid',
    issues,
  );
  const maxSessionSteps = parseInteger(
    record.maxSessionSteps,
    DEFAULT_MAX_SESSION_STEPS,
    10,
    10_000,
    'max_session_steps_invalid',
    issues,
  );
  const defaultCollectionId = parseOptionalUuid(
    record.defaultCollectionId,
    'default_collection_id_invalid',
    issues,
  );

  if (issues.length > 0) {
    return invalidPolicy(issues);
  }
  return {
    configured: true,
    issues: [],
    policy: {
      maxSessionSteps,
      maxStorageBytes,
      policyVersion: `managed-v${MANAGED_POLICY_SCHEMA_VERSION}`,
      rawImageRetention,
      sourceUrlRetention,
      ...(allowedOrigins ? { allowedOrigins } : {}),
      ...(deniedOrigins ? { deniedOrigins } : {}),
      ...(defaultCollectionId ? { defaultCollectionId } : {}),
    },
    valid: true,
  };
}

function invalidPolicy(issues: string[]): ManagedPolicySnapshot {
  return {
    configured: true,
    issues,
    policy: {
      ...defaults,
      allowedOrigins: [],
      policyVersion: 'managed-invalid-v1',
      sourceUrlRetention: 'none',
    },
    valid: false,
  };
}

function parseOrigins(value: unknown, key: string, issues: string[]): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > 1_000) {
    issues.push(`${key}_invalid`);
    return undefined;
  }
  const origins: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string' || candidate.length > 2_048) {
      issues.push(`${key}_invalid`);
      continue;
    }
    const normalized = normalizeOriginPattern(candidate);
    if (!normalized) {
      issues.push(`${key}_invalid`);
      continue;
    }
    origins.push(normalized);
  }
  return [...new Set(origins)];
}

function normalizeOriginPattern(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.startsWith('*.')) {
    const hostname = trimmed.slice(2).toLowerCase();
    if (hostnamePatternValid(hostname)) {
      return `*.${hostname}`;
    }
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function hostnamePatternValid(hostname: string): boolean {
  return (
    hostname.length > 0 &&
    hostname.length <= 253 &&
    hostname.includes('.') &&
    hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}

function parseEnum<T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback: T,
  issue: string,
  issues: string[],
): T {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === 'string' && choices.includes(value as T)) {
    return value as T;
  }
  issues.push(issue);
  return fallback;
}

function parseInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  issue: string,
  issues: string[],
): number {
  if (value === undefined) {
    return fallback;
  }
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  ) {
    return value;
  }
  issues.push(issue);
  return fallback;
}

function parseOptionalUuid(value: unknown, issue: string, issues: string[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    return value;
  }
  issues.push(issue);
  return undefined;
}
