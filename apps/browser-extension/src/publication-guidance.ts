import { GatewayError } from '@atrium-capture/atrium-client';

export interface PublicationFailureResponse {
  errorCode: string;
  requestId?: string;
}

const ERROR_CODE_PATTERN = /^[a-z0-9_]{1,100}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

export function publicationFailureResponse(error: unknown): PublicationFailureResponse {
  if (!(error instanceof GatewayError) || !ERROR_CODE_PATTERN.test(error.code)) {
    return { errorCode: 'publication_failed' };
  }
  return {
    errorCode: error.code,
    ...(error.requestId && REQUEST_ID_PATTERN.test(error.requestId)
      ? { requestId: error.requestId }
      : {}),
  };
}

export function parsePublicationFailureResponse(
  value: unknown,
): PublicationFailureResponse | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.errorCode !== 'string' || !ERROR_CODE_PATTERN.test(candidate.errorCode)) {
    return undefined;
  }
  if (
    candidate.requestId !== undefined &&
    (typeof candidate.requestId !== 'string' || !REQUEST_ID_PATTERN.test(candidate.requestId))
  ) {
    return undefined;
  }
  return {
    errorCode: candidate.errorCode,
    ...(typeof candidate.requestId === 'string' ? { requestId: candidate.requestId } : {}),
  };
}

export function publicationFailureMessage(errorCode: string, requestId?: string): string {
  const supportCode = ERROR_CODE_PATTERN.test(errorCode)
    ? `PUBLISH-${errorCode.toUpperCase().replaceAll('_', '-')}`
    : 'PUBLISH-FAILED';
  const requestReference =
    requestId && REQUEST_ID_PATTERN.test(requestId) ? ` Request ID: ${requestId}.` : '';

  if (errorCode === 'atrium_network_failed') {
    return `AI Studio could not be reached. Your reviewed guide remains local; check district network access and retry. Support code: ${supportCode}.${requestReference}`;
  }
  if (
    errorCode === 'forbidden' ||
    errorCode === 'insufficient_scope' ||
    errorCode === 'access_denied'
  ) {
    return `AI Studio signed you in but did not allow this operation. Your reviewed guide remains local; contact district support. Support code: ${supportCode}.${requestReference}`;
  }
  if (
    errorCode === 'atrium_collections_invalid' ||
    errorCode === 'atrium_collection_invalid' ||
    errorCode === 'atrium_response_invalid'
  ) {
    return `AI Studio returned a response Atrium Capture could not validate. Your reviewed guide remains local; contact district support. Support code: ${supportCode}.${requestReference}`;
  }
  return `AI Studio could not create the private draft. Your reviewed guide remains local and is safe to retry. Support code: ${supportCode}.${requestReference}`;
}
