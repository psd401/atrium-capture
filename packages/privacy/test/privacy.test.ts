import { describe, expect, it } from 'vitest';

import {
  classifyField,
  evaluateSiteAccess,
  genericInputInstruction,
  retainBrowserLocation,
  type FieldDescriptor,
} from '../src/index.js';

describe('field classification', () => {
  it('blocks password fields without reading a value property', () => {
    const descriptor = {
      get value(): never {
        throw new Error('value must never be read');
      },
      tagName: 'input',
      type: 'password',
    } as FieldDescriptor;

    expect(classifyField(descriptor)).toEqual({ capture: 'deny', reason: 'password' });
  });

  it.each(['current-password', 'new-password', 'one-time-code', 'cc-number', 'cc-csc'])(
    'blocks the %s autocomplete token',
    (autocomplete) => {
      expect(classifyField({ autocomplete, tagName: 'input', type: 'text' })).toMatchObject({
        capture: 'deny',
      });
    },
  );

  it('generates intent without a literal typed value', () => {
    expect(genericInputInstruction('Synthetic label')).toBe(
      'Enter the requested value in Synthetic label.',
    );
  });
});

describe('URL and site policy', () => {
  it('retains origin by default and strips query strings and fragments', () => {
    const url = 'https://example.test/path?student=synthetic#private';

    expect(retainBrowserLocation(url, 'origin')).toEqual({ origin: 'https://example.test' });
    expect(retainBrowserLocation(url, 'full')).toEqual({
      origin: 'https://example.test',
      path: '/path',
    });
  });

  it('applies deny rules before allow rules', () => {
    expect(
      evaluateSiteAccess('https://blocked.example.test/page', {
        allowedOrigins: ['*.example.test'],
        deniedOrigins: ['https://blocked.example.test'],
      }),
    ).toEqual({ allowed: false, reason: 'denied' });
  });
});
