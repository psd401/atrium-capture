import { GatewayError } from '@atrium-capture/atrium-client';
import { describe, expect, it } from 'vitest';

import {
  parsePublicationFailureResponse,
  publicationFailureMessage,
  publicationFailureResponse,
} from '../src/publication-guidance.js';

describe('publication failure guidance', () => {
  it('returns only bounded gateway diagnostics to the extension UI', () => {
    expect(
      publicationFailureResponse(
        new GatewayError('forbidden', false, 'remote detail must not cross', 'request-123'),
      ),
    ).toEqual({ errorCode: 'forbidden', requestId: 'request-123' });
    expect(publicationFailureResponse(new Error('token=must-not-cross'))).toEqual({
      errorCode: 'publication_failed',
    });
    expect(
      publicationFailureResponse(
        new GatewayError('bad code with secret=value', false, 'must not cross', 'bad request id'),
      ),
    ).toEqual({ errorCode: 'publication_failed' });
  });

  it('validates failure responses and gives actionable bounded instructions', () => {
    expect(
      parsePublicationFailureResponse({ errorCode: 'atrium_network_failed', requestId: 'req:1' }),
    ).toEqual({ errorCode: 'atrium_network_failed', requestId: 'req:1' });
    expect(
      parsePublicationFailureResponse({
        errorCode: 'atrium_network_failed',
        requestId: 'token=must-not-cross',
      }),
    ).toBeUndefined();
    expect(publicationFailureMessage('atrium_network_failed')).toContain(
      'PUBLISH-ATRIUM-NETWORK-FAILED',
    );
    expect(publicationFailureMessage('forbidden', 'req-2')).toContain('Request ID: req-2');
    expect(publicationFailureMessage('untrusted token=secret')).toContain('PUBLISH-FAILED');
    expect(publicationFailureMessage('untrusted token=secret')).not.toContain('secret');
  });
});
