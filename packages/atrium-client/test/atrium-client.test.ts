import {
  Action,
  AssetState,
  AtriumCaptureSessionState,
  MIMEType,
  Phase,
  PrivacyReview,
  ReviewStatus,
  SchemaVersion,
  Source,
  SourceURLRetention,
  Surface,
  type AtriumCapturePublishJob,
  type AtriumCaptureSession,
} from '@atrium-capture/contracts';
import { describe, expect, it } from 'vitest';

import {
  DurablePublisher,
  UnavailableAtriumGateway,
  createPkceRequest,
  generateMarkdown,
  loadCollectionChoices,
  parseAuthorizationCallback,
  type PublicationSource,
  type PublishJobStore,
} from '../src/index.js';
import { MockAtriumGateway, type MockFailurePoint } from '../src/mock-gateway.js';

const SESSION_ID = '10000000-0000-4000-8000-000000000001';
const JOB_ID = '50000000-0000-4000-8000-000000000001';
const ASSET_A = '30000000-0000-4000-8000-000000000001';
const ASSET_B = '30000000-0000-4000-8000-000000000002';
const RAW_ASSET = '30000000-0000-4000-8000-000000000003';

class MemoryJobStore implements PublishJobStore {
  readonly writes: AtriumCapturePublishJob[] = [];
  private readonly jobs = new Map<string, AtriumCapturePublishJob>();

  async load(jobId: string): Promise<AtriumCapturePublishJob | undefined> {
    return structuredClone(this.jobs.get(jobId));
  }

  async save(job: AtriumCapturePublishJob): Promise<void> {
    const snapshot = structuredClone(job);
    this.jobs.set(job.jobId, snapshot);
    this.writes.push(snapshot);
  }
}

class MemorySource implements PublicationSource {
  readonly loadedAssets: string[] = [];

  constructor(
    private readonly session: AtriumCaptureSession,
    private readonly assets: Map<string, Blob>,
  ) {}

  async loadAsset(assetId: string): Promise<Blob | undefined> {
    this.loadedAssets.push(assetId);
    return this.assets.get(assetId);
  }

  async loadSession(sessionId: string): Promise<AtriumCaptureSession | undefined> {
    return sessionId === this.session.sessionId ? structuredClone(this.session) : undefined;
  }
}

describe('durable publishing outbox', () => {
  const failurePoints: MockFailurePoint[] = [
    'create_object',
    `upload_asset:${ASSET_A}`,
    `upload_asset:${ASSET_B}`,
    'create_version',
  ];

  for (const failurePoint of failurePoints) {
    it(`recovers ${failurePoint} after a remote commit without duplication`, async () => {
      const fixture = await makeFixture();
      const gateway = new MockAtriumGateway({ failAfterCommit: [failurePoint] });
      const jobs = new MemoryJobStore();
      const source = new MemorySource(fixture.session, fixture.assets);
      const publisher = new DurablePublisher(gateway, jobs, source, tickingClock());
      const queued = await publisher.enqueue(fixture.session, {
        idFactory: () => JOB_ID,
        now: new Date('2026-01-15T15:00:00.000Z'),
      });

      const interrupted = await publisher.resume(queued.jobId);
      expect(interrupted.lastError?.code).toBe('synthetic_connection_lost_after_commit');
      const ready = await publisher.resume(queued.jobId);

      expect(ready.phase).toBe(Phase.ReadyAsDraft);
      expect(ready.readerUrl).toMatch(/^https:\/\/atrium\.example\.test\/reader\//);
      const snapshot = gateway.snapshot();
      expect(snapshot.objects).toHaveLength(1);
      expect(snapshot.objects[0]?.visibility).toBe('private');
      expect(snapshot.assets).toHaveLength(2);
      expect(snapshot.versions).toHaveLength(1);
      expect(source.loadedAssets).not.toContain(RAW_ASSET);
      expect(jobs.writes.some((job) => job.phase === Phase.CreatingObject)).toBe(true);
      expect(jobs.writes.some((job) => job.phase === Phase.UploadingAssets)).toBe(true);
      expect(jobs.writes.some((job) => job.phase === Phase.CreatingVersion)).toBe(true);
    });
  }

  it('requires a separate explicit action before changing a private draft to internal', async () => {
    const fixture = await makeFixture();
    const gateway = new MockAtriumGateway({ failAfterCommit: ['publish_internal'] });
    const jobs = new MemoryJobStore();
    const publisher = new DurablePublisher(
      gateway,
      jobs,
      new MemorySource(fixture.session, fixture.assets),
      tickingClock(),
    );
    const queued = await publisher.enqueue(fixture.session, { idFactory: () => JOB_ID });
    const draft = await publisher.resume(queued.jobId);

    expect(draft.phase).toBe(Phase.ReadyAsDraft);
    expect(gateway.snapshot().objects[0]?.visibility).toBe('private');

    const interrupted = await publisher.requestInternalPublication(queued.jobId);
    expect(interrupted.phase).toBe(Phase.PublishingInternal);
    expect(interrupted.lastError?.retryable).toBe(true);
    const complete = await publisher.resume(queued.jobId);

    expect(complete.phase).toBe(Phase.Complete);
    expect(gateway.snapshot().objects).toHaveLength(1);
    expect(gateway.snapshot().objects[0]?.visibility).toBe('internal');
  });

  it('freezes the create title across an ambiguous response, then syncs the latest title', async () => {
    const fixture = await makeFixture();
    const originalTitle = fixture.session.title;
    const gateway = new MockAtriumGateway({ failAfterCommit: ['create_object'] });
    const jobs = new MemoryJobStore();
    const publisher = new DurablePublisher(
      gateway,
      jobs,
      new MemorySource(fixture.session, fixture.assets),
      tickingClock(),
    );
    const queued = await publisher.enqueue(fixture.session, { idFactory: () => JOB_ID });

    const interrupted = await publisher.resume(queued.jobId);
    expect(interrupted.contentObjectId).toBeUndefined();
    fixture.session.title = 'Synthetic renamed after ambiguous create';

    const ready = await publisher.resume(queued.jobId);

    expect(ready.phase).toBe(Phase.ReadyAsDraft);
    expect(ready.createTitle).toBe(originalTitle);
    expect(ready.remoteTitle).toBe(fixture.session.title);
    expect(gateway.snapshot().objects).toEqual([
      expect.objectContaining({ title: fixture.session.title }),
    ]);
    expect(gateway.snapshot().requestCounts.create_object).toBe(2);
    expect(gateway.snapshot().requestCounts.update_title).toBe(1);
  });

  it('persists a legacy create title before the first remote request', async () => {
    const fixture = await makeFixture();
    const gateway = new MockAtriumGateway({ failAfterCommit: ['create_object'] });
    const jobs = new MemoryJobStore();
    const publisher = new DurablePublisher(
      gateway,
      jobs,
      new MemorySource(fixture.session, fixture.assets),
      tickingClock(),
    );
    const queued = await publisher.enqueue(fixture.session, { idFactory: () => JOB_ID });
    const legacy = { ...queued };
    delete legacy.createTitle;
    await jobs.save(legacy);
    fixture.session.title = 'Synthetic legacy title at first attempt';

    const interrupted = await publisher.resume(queued.jobId);

    expect(interrupted.createTitle).toBe(fixture.session.title);
    expect((await jobs.load(queued.jobId))?.createTitle).toBe(fixture.session.title);
    expect(gateway.snapshot().requestCounts.create_object).toBe(1);
  });

  it('updates the Atrium title after a draft is already ready', async () => {
    const fixture = await makeFixture();
    const gateway = new MockAtriumGateway();
    const publisher = new DurablePublisher(
      gateway,
      new MemoryJobStore(),
      new MemorySource(fixture.session, fixture.assets),
      tickingClock(),
    );
    const queued = await publisher.enqueue(fixture.session, { idFactory: () => JOB_ID });
    const ready = await publisher.resume(queued.jobId);
    fixture.session.title = 'Synthetic post-draft rename';

    const renamed = await publisher.syncTitle(ready.jobId);

    expect(renamed.phase).toBe(Phase.ReadyAsDraft);
    expect(renamed.remoteTitle).toBe(fixture.session.title);
    expect(gateway.snapshot().objects[0]?.title).toBe(fixture.session.title);
  });

  it('retries an interrupted title update without recreating the draft or version', async () => {
    const fixture = await makeFixture();
    const gateway = new MockAtriumGateway({ failAfterCommit: ['update_title'] });
    const publisher = new DurablePublisher(
      gateway,
      new MemoryJobStore(),
      new MemorySource(fixture.session, fixture.assets),
      tickingClock(),
    );
    const queued = await publisher.enqueue(fixture.session, { idFactory: () => JOB_ID });
    const ready = await publisher.resume(queued.jobId);
    fixture.session.title = 'Synthetic retryable title update';

    const interrupted = await publisher.syncTitle(ready.jobId);
    const recovered = await publisher.syncTitle(ready.jobId);

    expect(interrupted.lastError).toMatchObject({
      code: 'title_update_failed',
      retryable: true,
    });
    expect(recovered.remoteTitle).toBe(fixture.session.title);
    expect(recovered.lastError).toBeUndefined();
    expect(gateway.snapshot().objects).toHaveLength(1);
    expect(gateway.snapshot().versions).toHaveLength(1);
    expect(gateway.snapshot().requestCounts.update_title).toBe(2);
  });

  it('reconciles a title again after recovering an in-progress publication phase', async () => {
    const fixture = await makeFixture();
    const gateway = new MockAtriumGateway({ failAfterCommit: ['update_title'] });
    const jobs = new MemoryJobStore();
    const publisher = new DurablePublisher(
      gateway,
      jobs,
      new MemorySource(fixture.session, fixture.assets),
      tickingClock(),
    );
    const queued = await publisher.enqueue(fixture.session, { idFactory: () => JOB_ID });
    const ready = await publisher.resume(queued.jobId);
    fixture.session.title = 'Synthetic restart-phase title update';
    await jobs.save({ ...ready, phase: Phase.UploadingAssets });

    const recovered = await publisher.resume(queued.jobId);

    expect(recovered.phase).toBe(Phase.ReadyAsDraft);
    expect(recovered.remoteTitle).toBe(fixture.session.title);
    expect(recovered.lastError).toBeUndefined();
    expect(gateway.snapshot().objects).toHaveLength(1);
    expect(gateway.snapshot().versions).toHaveLength(1);
    expect(gateway.snapshot().requestCounts.update_title).toBe(2);
  });

  it('rejects review sessions and never puts raw assets into the upload plan', async () => {
    const fixture = await makeFixture();
    const reviewSession = {
      ...fixture.session,
      state: AtriumCaptureSessionState.Review,
      policy: { ...fixture.session.policy, reviewStatus: ReviewStatus.InReview },
    };
    const publisher = new DurablePublisher(
      new MockAtriumGateway(),
      new MemoryJobStore(),
      new MemorySource(reviewSession, fixture.assets),
    );

    await expect(publisher.enqueue(reviewSession)).rejects.toThrow('session_not_publishable');
  });

  it('escapes user-authored Markdown while using only gateway-issued asset references', async () => {
    const fixture = await makeFixture();
    fixture.session.title = '[Synthetic](https://untrusted.example)';
    fixture.session.steps[0]!.instruction.editedText =
      '<script>bad()</script> [link](https://bad.example)';
    const gateway = new MockAtriumGateway();
    const jobs = new MemoryJobStore();
    const publisher = new DurablePublisher(
      gateway,
      jobs,
      new MemorySource(fixture.session, fixture.assets),
      tickingClock(),
    );
    const job = await publisher.enqueue(fixture.session, { idFactory: () => JOB_ID });
    const ready = await publisher.resume(job.jobId);
    const markdown = gateway.snapshot().versions[0]?.markdown ?? '';

    expect(ready.phase).toBe(Phase.ReadyAsDraft);
    expect(markdown).toContain('mock-atrium-asset:');
    expect(markdown).not.toContain('untrusted.example');
    expect(markdown).not.toContain('[link](https://bad.example)');
    expect(generateMarkdown(fixture.session, ready, gateway)).toBe(markdown);
  });
});

describe('OAuth PKCE primitives', () => {
  it('creates an S256 request and validates the callback state', async () => {
    let seed = 0;
    const request = await createPkceRequest(
      {
        authorizationEndpoint: 'https://login.example.test/authorize',
        clientId: 'synthetic-client',
        redirectUri: 'https://extension.example.test/callback',
        resource: 'https://api.example.test',
        scopes: ['openid', 'atrium.publish'],
      },
      (length) => Uint8Array.from({ length }, () => (seed++ * 17) % 256),
    );
    const url = new URL(request.authorizationUrl);

    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(request.codeChallenge);
    expect(url.searchParams.get('resource')).toBe('https://api.example.test');
    expect(url.searchParams.get('scope')).toBe('openid atrium.publish');
    expect(
      parseAuthorizationCallback(
        `https://extension.example.test/callback?code=synthetic-code&state=${request.state}`,
        request.state,
      ),
    ).toBe('synthetic-code');
    expect(() =>
      parseAuthorizationCallback(
        'https://extension.example.test/callback?code=synthetic-code&state=wrong',
        request.state,
      ),
    ).toThrow('oauth_state_mismatch');
  });
});

describe('collection capability fallback', () => {
  it('uses a managed collection only when discovery is unavailable', async () => {
    const choices = await loadCollectionChoices(
      new UnavailableAtriumGateway(),
      '60000000-0000-4000-8000-000000000001',
    );

    expect(choices.source).toBe('managed_default');
    expect(choices.collections[0]?.name).toBe('Managed default');
  });

  it('fails closed without discovery or a managed default', async () => {
    await expect(loadCollectionChoices(new UnavailableAtriumGateway())).rejects.toThrow(
      'collection_selection_unavailable',
    );
  });
});

async function makeFixture(): Promise<{
  assets: Map<string, Blob>;
  session: AtriumCaptureSession;
}> {
  const assetA = new Blob(['synthetic-publishable-image-a'], { type: 'image/png' });
  const assetB = new Blob(['synthetic-publishable-image-b'], { type: 'image/png' });
  const raw = new Blob(['SYNTHETIC-RAW-SENTINEL-NEVER-UPLOAD'], { type: 'image/png' });
  const now = new Date('2026-01-15T15:00:00.000Z');
  return {
    assets: new Map([
      [ASSET_A, assetA],
      [ASSET_B, assetB],
      [RAW_ASSET, raw],
    ]),
    session: {
      assets: [
        await assetRecord(ASSET_A, assetA, AssetState.PublishableLocal),
        await assetRecord(ASSET_B, assetB, AssetState.PublishableLocal),
        await assetRecord(RAW_ASSET, raw, AssetState.RawLocal),
      ],
      createdAt: now,
      policy: {
        policyVersion: 'fixture-v1',
        reviewStatus: ReviewStatus.Approved,
        sourceUrlRetention: SourceURLRetention.Origin,
      },
      recorder: { appVersion: '0.1.0', surface: Surface.Browser },
      revision: 9,
      schemaVersion: SchemaVersion.The10,
      sessionId: SESSION_ID,
      state: AtriumCaptureSessionState.Publishable,
      steps: [
        step('20000000-0000-4000-8000-000000000001', 0, ASSET_A),
        step('20000000-0000-4000-8000-000000000002', 1, ASSET_B),
      ],
      title: 'Synthetic guide',
      updatedAt: now,
    },
  };
}

async function assetRecord(assetId: string, bytes: Blob, state: AssetState) {
  return {
    assetId,
    localKey: `fixture/${assetId}.png`,
    mimeType: MIMEType.ImagePNG,
    pixelHeight: 1,
    pixelWidth: 1,
    sha256: await sha256Hex(bytes),
    state,
  };
}

function step(stepId: string, sequence: number, screenshotAssetId: string) {
  return {
    action: Action.Click,
    instruction: {
      generatedText: `Select synthetic control ${sequence + 1}.`,
      source: Source.Rules,
      userEdited: false,
    },
    occurredAt: new Date(`2026-01-15T15:00:0${sequence}.000Z`),
    privacyReview: PrivacyReview.Approved,
    screenshotAssetId,
    sequence,
    stepId,
  };
}

function tickingClock(): () => Date {
  let milliseconds = Date.parse('2026-01-15T15:00:00.000Z');
  return () => new Date(milliseconds++);
}

async function sha256Hex(bytes: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await bytes.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
