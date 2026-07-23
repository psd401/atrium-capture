import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_SESSION_STEPS,
  DEFAULT_MAX_STORAGE_BYTES,
  ManagedPolicyProvider,
  parseManagedPolicy,
} from '../src/managed-policy.js';

describe('managed policy boundary', () => {
  it('uses privacy-preserving defaults for an unmanaged installation', () => {
    const snapshot = parseManagedPolicy({});

    expect(snapshot).toMatchObject({
      configured: false,
      issues: [],
      policy: {
        maxSessionSteps: DEFAULT_MAX_SESSION_STEPS,
        maxStorageBytes: DEFAULT_MAX_STORAGE_BYTES,
        rawImageRetention: 'delete_after_flatten',
        sourceUrlRetention: 'origin',
      },
      valid: true,
    });
    expect(snapshot.policy.allowedOrigins).toBeUndefined();
  });

  it('normalizes a complete managed policy and preserves deny precedence', () => {
    const snapshot = parseManagedPolicy({
      allowedOrigins: ['HTTPS://Portal.Example.Test', '*.Example.Test', '*.example.test'],
      defaultCollectionId: '60000000-0000-4000-8000-000000000001',
      deniedOrigins: ['https://accounts.example.test'],
      maxSessionSteps: 500,
      maxStorageBytes: 268_435_456,
      rawImageRetention: 'delete_after_submit',
      schemaVersion: 1,
      sourceUrlRetention: 'none',
    });

    expect(snapshot.valid).toBe(true);
    expect(snapshot.policy.allowedOrigins).toEqual([
      'https://portal.example.test',
      '*.example.test',
    ]);
    expect(snapshot.policy.deniedOrigins).toEqual(['https://accounts.example.test']);
    expect(snapshot.policy.defaultCollectionId).toBe('60000000-0000-4000-8000-000000000001');
    expect(snapshot.policy.rawImageRetention).toBe('delete_after_submit');
  });

  it('fails closed when a configured policy is malformed or has unknown keys', () => {
    const snapshot = parseManagedPolicy({
      allowedOrigins: ['https://example.test/path'],
      inventedBypass: true,
      schemaVersion: 99,
      sourceUrlRetention: 'query-string',
    });

    expect(snapshot.valid).toBe(false);
    expect(snapshot.policy.allowedOrigins).toEqual([]);
    expect(snapshot.policy.sourceUrlRetention).toBe('none');
    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        'unknown_key:inventedBypass',
        'schema_version_invalid',
        'allowedOrigins_invalid',
        'source_url_retention_invalid',
      ]),
    );
  });

  it('fails closed when managed storage cannot be read', async () => {
    const provider = new ManagedPolicyProvider({
      async get() {
        throw new Error('synthetic_managed_storage_failure');
      },
    });

    const snapshot = await provider.load();
    expect(snapshot.valid).toBe(false);
    expect(snapshot.policy.allowedOrigins).toEqual([]);
    expect(snapshot.issues).toEqual(['managed_storage_unavailable']);
  });
});
