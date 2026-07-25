import { Phase, type AtriumCapturePublishJob } from '@atrium-capture/contracts';
import {
  DurablePublisher,
  GatewayError,
  loadCollectionChoices,
  type AtriumCapabilities,
  type AtriumCollection,
  type AtriumGateway,
  type PublicationSource,
  type PublishJobStore,
} from '@atrium-capture/atrium-client';

import { CaptureRepository } from './database.js';

export interface PublicationSnapshot {
  authentication: 'not_required' | 'signed_in' | 'signed_out' | 'unconfigured';
  capabilities: AtriumCapabilities;
  collectionSource?: 'discovery' | 'managed_default';
  collections: AtriumCollection[];
  job?: AtriumCapturePublishJob;
}

export class BrowserPublicationService {
  private readonly publisher: DurablePublisher;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: CaptureRepository,
    private readonly gateway: AtriumGateway,
    private readonly loadManagedDefaultCollectionId: () => Promise<string | undefined> = async () =>
      undefined,
    private readonly loadAuthenticationStatus?: () => Promise<
      'signed_in' | 'signed_out' | 'unconfigured'
    >,
  ) {
    const jobs: PublishJobStore = {
      load: (jobId) => repository.getPublishJob(jobId),
      save: (job) => repository.putPublishJob(job),
    };
    const source: PublicationSource = {
      loadAsset: async (assetId) => (await repository.getStoredAsset(assetId))?.blob,
      loadSession: (sessionId) => repository.getSession(sessionId),
    };
    this.publisher = new DurablePublisher(gateway, jobs, source);
  }

  async snapshot(): Promise<PublicationSnapshot> {
    const capabilities = await this.gateway.capabilities();
    const authentication = await this.authentication(capabilities);
    const session = await this.repository.getActiveSession();
    const job = session
      ? await this.repository.getLatestPublishJobForSession(session.sessionId)
      : undefined;
    try {
      const choices = await loadCollectionChoices(
        this.gateway,
        await this.loadManagedDefaultCollectionId(),
      );
      return {
        capabilities,
        authentication,
        collections: choices.collections,
        collectionSource: choices.source,
        ...(job ? { job } : {}),
      };
    } catch {
      return { authentication, capabilities, collections: [], ...(job ? { job } : {}) };
    }
  }

  async enqueue(collectionId?: string): Promise<AtriumCapturePublishJob> {
    return this.serialize(() => this.enqueueExclusive(collectionId));
  }

  async publishInternal(jobId: string): Promise<AtriumCapturePublishJob> {
    return this.serialize(async () => {
      const capabilities = await this.gateway.capabilities();
      assertDraftPublishingAvailable(capabilities, await this.authentication(capabilities));
      const job = await this.publisher.requestInternalPublication(jobId);
      await this.markSubmitted(job);
      await this.recordHealth(job);
      return job;
    });
  }

  async resume(jobId: string): Promise<AtriumCapturePublishJob> {
    return this.serialize(() => this.drive(jobId));
  }

  async syncTitleForSession(sessionId: string): Promise<AtriumCapturePublishJob | undefined> {
    return this.serialize(async () => {
      const job = await this.repository.getLatestPublishJobForSession(sessionId);
      if (!job) {
        return undefined;
      }
      const synced = await this.publisher.syncTitle(job.jobId);
      await this.recordHealth(synced);
      return synced;
    });
  }

  async resumePending(): Promise<void> {
    return this.serialize(async () => {
      const capabilities = await this.gateway.capabilities();
      if (!draftPublishingAvailable(capabilities, await this.authentication(capabilities))) {
        return;
      }
      const jobs = await this.repository.listPublishJobs();
      for (const job of jobs) {
        if (job.phase === Phase.Complete || job.phase === Phase.ReadyAsDraft) {
          const synced = await this.publisher.syncTitle(job.jobId);
          await this.markSubmitted(synced);
          await this.recordHealth(synced);
          continue;
        }
        if (job.phase !== Phase.NeedsAttention) {
          await this.drive(job.jobId);
        } else {
          const synced = await this.publisher.syncTitle(job.jobId);
          await this.recordHealth(synced);
        }
      }
    });
  }

  private async enqueueExclusive(collectionId?: string): Promise<AtriumCapturePublishJob> {
    const capabilities = await this.gateway.capabilities();
    assertDraftPublishingAvailable(capabilities, await this.authentication(capabilities));
    const session = await this.repository.getActiveSession();
    if (!session) {
      throw new GatewayError('publish_session_missing', false);
    }
    const existing = await this.repository.getLatestPublishJobForSession(session.sessionId);
    if (existing) {
      return this.drive(existing.jobId);
    }
    const choices = await loadCollectionChoices(
      this.gateway,
      await this.loadManagedDefaultCollectionId(),
    );
    const selectedCollectionId = collectionId ?? choices.collections[0]?.collectionId;
    if (
      selectedCollectionId &&
      !choices.collections.some((collection) => collection.collectionId === selectedCollectionId)
    ) {
      throw new GatewayError('collection_not_available', false);
    }
    const job = await this.publisher.enqueue(session, {
      ...(selectedCollectionId ? { collectionId: selectedCollectionId } : {}),
    });
    return this.drive(job.jobId);
  }

  private async drive(jobId: string): Promise<AtriumCapturePublishJob> {
    const job = await this.publisher.resume(jobId);
    await this.markSubmitted(job);
    await this.recordHealth(job);
    return job;
  }

  private async authentication(
    capabilities: AtriumCapabilities,
  ): Promise<PublicationSnapshot['authentication']> {
    if (capabilities.mode === 'mock') {
      return 'not_required';
    }
    if (!capabilities.oauth) {
      return 'unconfigured';
    }
    return this.loadAuthenticationStatus ? this.loadAuthenticationStatus() : 'signed_out';
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async markSubmitted(job: AtriumCapturePublishJob): Promise<void> {
    if (job.phase === Phase.ReadyAsDraft || job.phase === Phase.Complete) {
      await this.repository.markSessionSubmitted(job.sessionId);
    }
  }

  private async recordHealth(job: AtriumCapturePublishJob): Promise<void> {
    if (job.lastError?.retryable) {
      await this.repository
        .recordHealthEvent('publication_retryable', 'warning')
        .catch(() => undefined);
    } else if (job.lastError || job.phase === Phase.NeedsAttention) {
      await this.repository
        .recordHealthEvent('publication_attention', 'error')
        .catch(() => undefined);
    } else if (job.phase === Phase.ReadyAsDraft || job.phase === Phase.Complete) {
      await this.repository.recordHealthEvent('publication_ready').catch(() => undefined);
    }
  }
}

function assertDraftPublishingAvailable(
  capabilities: AtriumCapabilities,
  authentication: PublicationSnapshot['authentication'],
): void {
  if (!draftPublishingAvailable(capabilities, authentication)) {
    throw new GatewayError('draft_publishing_unavailable', false);
  }
}

function draftPublishingAvailable(
  capabilities: AtriumCapabilities,
  authentication: PublicationSnapshot['authentication'],
): boolean {
  return (
    capabilities.idempotentWrites &&
    capabilities.immutableAssets &&
    (authentication === 'not_required' || authentication === 'signed_in')
  );
}
