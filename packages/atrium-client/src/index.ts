import {
  AssetState,
  AssetUploadState,
  AtriumCaptureSessionState,
  Phase,
  ReviewStatus,
  SchemaVersion,
  type AssetElement,
  type AtriumCapturePublishJob,
  type AtriumCaptureSession,
  type LastError,
} from '@atrium-capture/contracts';

export interface AtriumCapabilities {
  collectionDiscovery: boolean;
  contentUpdates: boolean;
  idempotentWrites: boolean;
  immutableAssets: boolean;
  internalPublication: boolean;
  mode: 'live' | 'live_unavailable' | 'mock';
  oauth: boolean;
  reasons: string[];
}

export interface AtriumCollection {
  collectionId: string;
  name: string;
}

export interface CaptureSourceRef {
  capturedAt: string;
  clientSurface: 'browser' | 'mac';
  clientVersion: string;
  externalId: string;
  provider: 'atrium-capture';
  sourceOrigins?: string[];
  type: 'capture';
}

export interface CollectionChoices {
  collections: AtriumCollection[];
  source: 'discovery' | 'managed_default';
}

export interface CreatePrivateObjectRequest {
  collectionId?: string;
  idempotencyKey: string;
  sourceRef: CaptureSourceRef;
  title: string;
  visibility: 'private';
}

export interface UploadImmutableAssetRequest {
  bytes: Blob;
  contentObjectId: string;
  idempotencyKey: string;
  localAssetId: string;
  mimeType: string;
  pixelHeight: number;
  pixelWidth: number;
  sha256: string;
}

export interface CreateMarkdownVersionRequest {
  contentObjectId: string;
  idempotencyKey: string;
  markdown: string;
}

export interface UpdateContentTitleRequest {
  contentObjectId: string;
  title: string;
}

export interface AtriumGateway {
  capabilities(): Promise<AtriumCapabilities>;
  createMarkdownVersion(
    request: CreateMarkdownVersionRequest,
  ): Promise<{ readerUrl: string; versionId: string }>;
  createPrivateObject(request: CreatePrivateObjectRequest): Promise<{ contentObjectId: string }>;
  formatAssetMarkdown(remoteAssetId: string, altText: string): string;
  listCollections(): Promise<AtriumCollection[]>;
  publishInternal(request: {
    contentObjectId: string;
    idempotencyKey: string;
    versionId: string;
  }): Promise<void>;
  updateContentTitle(
    request: UpdateContentTitleRequest,
  ): Promise<{ contentObjectId: string; title: string }>;
  uploadImmutableAsset(request: UploadImmutableAssetRequest): Promise<{ remoteAssetId: string }>;
}

export interface PublishJobStore {
  load(jobId: string): Promise<AtriumCapturePublishJob | undefined>;
  save(job: AtriumCapturePublishJob): Promise<void>;
}

export interface PublicationSource {
  loadAsset(assetId: string): Promise<Blob | undefined>;
  loadSession(sessionId: string): Promise<AtriumCaptureSession | undefined>;
}

export interface CreatePublishJobOptions {
  collectionId?: string;
  idFactory?: () => string;
  now?: Date;
}

export class GatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    message = code,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export class UnavailableAtriumGateway implements AtriumGateway {
  async capabilities(): Promise<AtriumCapabilities> {
    return {
      collectionDiscovery: false,
      contentUpdates: false,
      idempotentWrites: false,
      immutableAssets: false,
      internalPublication: false,
      mode: 'live_unavailable',
      oauth: false,
      reasons: [
        'Atrium production OAuth, immutable asset, and idempotent content contracts are not available.',
      ],
    };
  }

  async createMarkdownVersion(): Promise<never> {
    return unavailable();
  }

  async createPrivateObject(): Promise<never> {
    return unavailable();
  }

  formatAssetMarkdown(): never {
    throw new GatewayError('live_integration_unavailable', false);
  }

  async listCollections(): Promise<never> {
    return unavailable();
  }

  async publishInternal(): Promise<never> {
    return unavailable();
  }

  async uploadImmutableAsset(): Promise<never> {
    return unavailable();
  }

  async updateContentTitle(): Promise<never> {
    return unavailable();
  }
}

export async function loadCollectionChoices(
  gateway: AtriumGateway,
  managedDefaultCollectionId?: string,
): Promise<CollectionChoices> {
  const capabilities = await gateway.capabilities();
  if (capabilities.collectionDiscovery) {
    return { collections: await gateway.listCollections(), source: 'discovery' };
  }
  if (managedDefaultCollectionId) {
    return {
      collections: [{ collectionId: managedDefaultCollectionId, name: 'Managed default' }],
      source: 'managed_default',
    };
  }
  throw new GatewayError('collection_selection_unavailable', false);
}

export function createPublishJob(
  session: AtriumCaptureSession,
  options: CreatePublishJobOptions = {},
): AtriumCapturePublishJob {
  assertPublishableSession(session);
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const jobId = idFactory();
  const now = options.now ?? new Date();
  const assets = publishableAssets(session);
  return {
    assetUploads: assets.map((asset) => ({
      idempotencyKey: idempotencyKey(jobId, `asset:${asset.assetId}`),
      localAssetId: asset.assetId,
      state: AssetUploadState.Pending,
    })),
    attemptCount: 0,
    createIdempotencyKey: idempotencyKey(jobId, 'create'),
    createTitle: session.title,
    createdAt: now,
    jobId,
    phase: Phase.Queued,
    schemaVersion: SchemaVersion.The10,
    sessionId: session.sessionId,
    updatedAt: now,
    ...(options.collectionId ? { collectionId: options.collectionId } : {}),
  };
}

export class DurablePublisher {
  constructor(
    private readonly gateway: AtriumGateway,
    private readonly jobs: PublishJobStore,
    private readonly source: PublicationSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async enqueue(
    session: AtriumCaptureSession,
    options: CreatePublishJobOptions = {},
  ): Promise<AtriumCapturePublishJob> {
    const job = createPublishJob(session, options);
    await this.jobs.save(job);
    return job;
  }

  async resume(jobId: string): Promise<AtriumCapturePublishJob> {
    let job = await this.syncTitle(jobId);
    if (job.phase === Phase.Complete || job.phase === Phase.ReadyAsDraft) {
      return job;
    }
    const jobWithoutLastError = { ...job };
    delete jobWithoutLastError.lastError;
    job = await this.save({
      ...jobWithoutLastError,
      attemptCount: job.attemptCount + 1,
    });
    try {
      while (true) {
        switch (job.phase) {
          case Phase.Queued:
            job = await this.save({ ...job, phase: Phase.CreatingObject });
            break;
          case Phase.CreatingObject:
            job = await this.createObject(job);
            job = await this.syncTitle(job.jobId);
            break;
          case Phase.UploadingAssets:
            job = await this.uploadAssets(job);
            break;
          case Phase.CreatingVersion:
            job = await this.createVersion(job);
            break;
          case Phase.PublishingInternal:
            job = await this.publishInternal(job);
            break;
          case Phase.ReadyAsDraft:
          case Phase.Complete:
          case Phase.NeedsAttention:
            return this.syncTitle(job.jobId);
        }
      }
    } catch (error) {
      const normalized = normalizeError(error);
      const latest = (await this.jobs.load(jobId)) ?? job;
      return this.save({
        ...latest,
        lastError: normalized,
        ...(normalized.retryable ? {} : { phase: Phase.NeedsAttention }),
      });
    }
  }

  /**
   * Explicitly retries a job that previously stopped on a non-retryable
   * response. Recovery resumes from durable remote identifiers and per-asset
   * receipts, so an updated client can repair a response-contract mismatch
   * without creating duplicate objects, assets, or versions.
   */
  async retry(jobId: string): Promise<AtriumCapturePublishJob> {
    let job = await this.requireJob(jobId);
    if (job.phase === Phase.NeedsAttention) {
      const next = { ...job, phase: recoveryPhase(job) };
      delete next.lastError;
      job = await this.save(next);
    }
    return this.resume(job.jobId);
  }

  async requestInternalPublication(jobId: string): Promise<AtriumCapturePublishJob> {
    let job = await this.requireJob(jobId);
    if (job.phase === Phase.Complete) {
      return job;
    }
    if (job.phase === Phase.PublishingInternal) {
      return this.resume(job.jobId);
    }
    if (job.phase !== Phase.ReadyAsDraft || !job.contentObjectId) {
      throw new Error('draft_not_ready');
    }
    job = await this.save({ ...job, phase: Phase.PublishingInternal });
    return this.resume(job.jobId);
  }

  async syncTitle(jobId: string): Promise<AtriumCapturePublishJob> {
    const job = await this.requireJob(jobId);
    if (!job.contentObjectId) {
      return job;
    }
    const session = await this.requireStoredSession(job.sessionId);
    if (job.remoteTitle === session.title) {
      return job;
    }
    try {
      await this.requireCapability('contentUpdates');
      const response = await this.gateway.updateContentTitle({
        contentObjectId: job.contentObjectId,
        title: session.title,
      });
      if (response.contentObjectId !== job.contentObjectId || response.title !== session.title) {
        throw new GatewayError('atrium_title_update_response_invalid', false);
      }
      const next = { ...job, remoteTitle: response.title };
      if (next.lastError?.code === 'title_update_failed') {
        delete next.lastError;
      }
      return this.save(next);
    } catch (error) {
      const normalized = normalizeError(error);
      return this.save({
        ...job,
        lastError: {
          ...normalized,
          code: 'title_update_failed',
          message: normalized.code,
        },
      });
    }
  }

  private async createObject(job: AtriumCapturePublishJob): Promise<AtriumCapturePublishJob> {
    if (job.contentObjectId) {
      return this.save({ ...job, phase: Phase.UploadingAssets });
    }
    await this.requireCapability('idempotentWrites');
    const session = await this.requireSession(job.sessionId);
    if (!job.createTitle) {
      await this.save({ ...job, createTitle: session.title });
      job = await this.requireJob(job.jobId);
    }
    const createTitle = job.createTitle ?? session.title;
    const response = await this.gateway.createPrivateObject({
      idempotencyKey: job.createIdempotencyKey,
      sourceRef: captureSourceRef(session),
      title: createTitle,
      visibility: 'private',
      ...(job.collectionId ? { collectionId: job.collectionId } : {}),
    });
    return this.save({
      ...job,
      contentObjectId: response.contentObjectId,
      phase: Phase.UploadingAssets,
      remoteTitle: createTitle,
    });
  }

  private async uploadAssets(job: AtriumCapturePublishJob): Promise<AtriumCapturePublishJob> {
    if (!job.contentObjectId) {
      throw new GatewayError('content_object_missing', false);
    }
    const contentObjectId = job.contentObjectId;
    await this.requireCapability('immutableAssets');
    const session = await this.requireSession(job.sessionId);
    let uploads = job.assetUploads ?? [];
    for (let index = 0; index < uploads.length; index += 1) {
      const upload = uploads[index];
      if (!upload || (upload.state === AssetUploadState.Ready && upload.remoteAssetId)) {
        continue;
      }
      const asset = requirePublishableAsset(session, upload.localAssetId);
      const bytes = await this.source.loadAsset(asset.assetId);
      if (!bytes) {
        throw new GatewayError('publishable_asset_missing', false);
      }
      uploads = replaceUpload(uploads, index, { ...upload, state: AssetUploadState.Uploading });
      job = await this.save({ ...job, assetUploads: uploads });
      const response = await this.gateway.uploadImmutableAsset({
        bytes,
        contentObjectId,
        idempotencyKey: upload.idempotencyKey,
        localAssetId: asset.assetId,
        mimeType: asset.mimeType,
        pixelHeight: asset.pixelHeight,
        pixelWidth: asset.pixelWidth,
        sha256: asset.sha256,
      });
      uploads = replaceUpload(uploads, index, {
        ...upload,
        remoteAssetId: response.remoteAssetId,
        state: AssetUploadState.Ready,
      });
      job = await this.save({ ...job, assetUploads: uploads });
    }
    return this.save({ ...job, assetUploads: uploads, phase: Phase.CreatingVersion });
  }

  private async createVersion(job: AtriumCapturePublishJob): Promise<AtriumCapturePublishJob> {
    if (!job.contentObjectId) {
      throw new GatewayError('content_object_missing', false);
    }
    if (job.currentVersionId && job.readerUrl) {
      return this.save({ ...job, phase: Phase.ReadyAsDraft });
    }
    await this.requireCapability('idempotentWrites');
    const session = await this.requireSession(job.sessionId);
    const markdown = generateMarkdown(session, job, this.gateway);
    const response = await this.gateway.createMarkdownVersion({
      contentObjectId: job.contentObjectId,
      idempotencyKey: idempotencyKey(job.jobId, 'version'),
      markdown,
    });
    return this.save({
      ...job,
      currentVersionId: response.versionId,
      phase: Phase.ReadyAsDraft,
      readerUrl: response.readerUrl,
    });
  }

  private async publishInternal(job: AtriumCapturePublishJob): Promise<AtriumCapturePublishJob> {
    if (!job.contentObjectId || !job.currentVersionId) {
      throw new GatewayError('content_object_missing', false);
    }
    const versionId = job.currentVersionId;
    await this.requireCapability('internalPublication');
    await this.gateway.publishInternal({
      contentObjectId: job.contentObjectId,
      idempotencyKey: idempotencyKey(job.jobId, 'publish-internal'),
      versionId,
    });
    return this.save({ ...job, phase: Phase.Complete });
  }

  private async requireJob(jobId: string): Promise<AtriumCapturePublishJob> {
    const job = await this.jobs.load(jobId);
    if (!job) {
      throw new Error('publish_job_not_found');
    }
    return job;
  }

  private async requireSession(sessionId: string): Promise<AtriumCaptureSession> {
    const session = await this.requireStoredSession(sessionId);
    assertPublishableSession(session);
    return session;
  }

  private async requireStoredSession(sessionId: string): Promise<AtriumCaptureSession> {
    const session = await this.source.loadSession(sessionId);
    if (!session) {
      throw new GatewayError('publish_session_missing', false);
    }
    return session;
  }

  private async save(job: AtriumCapturePublishJob): Promise<AtriumCapturePublishJob> {
    const next = { ...job, updatedAt: this.now() };
    await this.jobs.save(next);
    return next;
  }

  private async requireCapability(
    capability: 'contentUpdates' | 'idempotentWrites' | 'immutableAssets' | 'internalPublication',
  ): Promise<void> {
    if (!(await this.gateway.capabilities())[capability]) {
      throw new GatewayError(`atrium_${capability}_unavailable`, false);
    }
  }
}

function recoveryPhase(job: AtriumCapturePublishJob): Phase {
  if (!job.contentObjectId) {
    return Phase.CreatingObject;
  }
  if ((job.assetUploads ?? []).some((asset) => asset.state !== AssetUploadState.Ready)) {
    return Phase.UploadingAssets;
  }
  if (!job.currentVersionId) {
    return Phase.CreatingVersion;
  }
  return Phase.PublishingInternal;
}

export interface PkceAuthorizationConfig {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  resource?: string;
  scopes: readonly string[];
}

export interface PkceRequest {
  authorizationUrl: string;
  codeChallenge: string;
  codeVerifier: string;
  state: string;
}

export async function createPkceRequest(
  config: PkceAuthorizationConfig,
  randomBytes: (length: number) => Uint8Array = secureRandomBytes,
): Promise<PkceRequest> {
  const codeVerifier = base64Url(randomBytes(32));
  const state = base64Url(randomBytes(24));
  const challengeBytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = base64Url(new Uint8Array(challengeBytes));
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes.join(' '));
  if (config.resource) {
    url.searchParams.set('resource', config.resource);
  }
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return { authorizationUrl: url.toString(), codeChallenge, codeVerifier, state };
}

export function parseAuthorizationCallback(callbackUrl: string, expectedState: string): string {
  const url = new URL(callbackUrl);
  if (url.searchParams.get('state') !== expectedState) {
    throw new Error('oauth_state_mismatch');
  }
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    throw new Error('oauth_authorization_denied');
  }
  const code = url.searchParams.get('code');
  if (!code || code.length > 16_384) {
    throw new Error('oauth_code_missing');
  }
  return code;
}

export function generateMarkdown(
  session: AtriumCaptureSession,
  job: AtriumCapturePublishJob,
  gateway: Pick<AtriumGateway, 'formatAssetMarkdown'>,
): string {
  const remoteByLocal = new Map(
    (job.assetUploads ?? [])
      .filter((upload) => upload.remoteAssetId)
      .map((upload) => [upload.localAssetId, upload.remoteAssetId as string]),
  );
  const lines = ['## Steps', ''];
  for (const step of session.steps) {
    lines.push(
      `## Step ${step.sequence + 1}`,
      '',
      escapeMarkdown(step.instruction.editedText ?? step.instruction.generatedText),
      '',
    );
    if (step.screenshotAssetId) {
      const remoteAssetId = remoteByLocal.get(step.screenshotAssetId);
      if (!remoteAssetId) {
        throw new GatewayError('remote_asset_missing', false);
      }
      lines.push(gateway.formatAssetMarkdown(remoteAssetId, `Step ${step.sequence + 1}`), '');
    }
  }
  return lines.join('\n').trimEnd() + '\n';
}

function assertPublishableSession(session: AtriumCaptureSession): void {
  if (
    session.state !== AtriumCaptureSessionState.Publishable ||
    session.policy.reviewStatus !== ReviewStatus.Approved
  ) {
    throw new Error('session_not_publishable');
  }
}

function publishableAssets(session: AtriumCaptureSession): AssetElement[] {
  return session.assets.filter((asset) => asset.state === AssetState.PublishableLocal);
}

function requirePublishableAsset(session: AtriumCaptureSession, assetId: string): AssetElement {
  const asset = session.assets.find(
    (candidate) => candidate.assetId === assetId && candidate.state === AssetState.PublishableLocal,
  );
  if (!asset) {
    throw new GatewayError('asset_not_publishable', false);
  }
  return asset;
}

function replaceUpload<T>(uploads: readonly T[], index: number, value: T): T[] {
  return uploads.map((candidate, candidateIndex) => (candidateIndex === index ? value : candidate));
}

function idempotencyKey(jobId: string, operation: string): string {
  return `capture:${jobId}:${operation}`;
}

function captureSourceRef(session: AtriumCaptureSession): CaptureSourceRef {
  const sourceOrigins =
    session.policy.sourceUrlRetention === 'none'
      ? []
      : [
          ...new Set(
            session.steps
              .map((step) => step.target?.browser?.origin)
              .filter((origin): origin is string => Boolean(origin))
              .map(normalizeCaptureSourceOriginForPublication)
              .filter((origin): origin is string => Boolean(origin)),
          ),
        ].slice(0, 20);
  return {
    capturedAt: session.createdAt.toISOString(),
    clientSurface: session.recorder.surface === 'macos' ? 'mac' : 'browser',
    clientVersion: session.recorder.appVersion,
    externalId: session.sessionId,
    provider: 'atrium-capture',
    ...(sourceOrigins.length > 0 ? { sourceOrigins } : {}),
    type: 'capture',
  };
}

/**
 * Retain web provenance without sending literal local-network targets across the
 * production boundary. Apart from disclosing workstation topology, loopback and
 * private-address literals are commonly rejected by edge SSRF protections.
 * Internal district DNS names remain valid because they are meaningful origins
 * and are not resolved by the capture client.
 */
export function normalizeCaptureSourceOriginForPublication(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      isLocalNetworkHostLiteral(url.hostname)
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function isLocalNetworkHostLiteral(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return true;
  }

  const octets = hostname.split('.');
  if (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  ) {
    return isLocalIPv4(octets.map(Number));
  }

  const mappedIPv4 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(hostname);
  if (mappedIPv4) {
    const high = Number.parseInt(mappedIPv4[1] ?? '', 16);
    const low = Number.parseInt(mappedIPv4[2] ?? '', 16);
    return isLocalIPv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }

  return (
    hostname === '::' ||
    hostname === '::1' ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd') ||
    hostname.startsWith('fe8') ||
    hostname.startsWith('fe9') ||
    hostname.startsWith('fea') ||
    hostname.startsWith('feb')
  );
}

function isLocalIPv4([first = 0, second = 0]: number[]): boolean {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function normalizeError(error: unknown): LastError {
  if (error instanceof GatewayError) {
    return {
      code: error.code,
      message: error.message.slice(0, 1_000),
      retryable: error.retryable,
      ...(error.requestId ? { requestId: error.requestId } : {}),
    };
  }
  return { code: 'network_error', message: 'Atrium request failed.', retryable: true };
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+.!|>-])/g, '\\$1');
}

function secureRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function unavailable(): Promise<never> {
  return Promise.reject(new GatewayError('live_integration_unavailable', false));
}
