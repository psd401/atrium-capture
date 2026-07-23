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
  capabilities: AtriumCapabilities;
  collectionSource?: 'discovery' | 'managed_default';
  collections: AtriumCollection[];
  job?: AtriumCapturePublishJob;
}

export class BrowserPublicationService {
  private readonly publisher: DurablePublisher;

  constructor(
    private readonly repository: CaptureRepository,
    private readonly gateway: AtriumGateway,
    private readonly managedDefaultCollectionId?: string,
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
    const session = await this.repository.getActiveSession();
    const job = session
      ? await this.repository.getLatestPublishJobForSession(session.sessionId)
      : undefined;
    try {
      const choices = await loadCollectionChoices(this.gateway, this.managedDefaultCollectionId);
      return {
        capabilities,
        collections: choices.collections,
        collectionSource: choices.source,
        ...(job ? { job } : {}),
      };
    } catch {
      return { capabilities, collections: [], ...(job ? { job } : {}) };
    }
  }

  async enqueue(collectionId?: string): Promise<AtriumCapturePublishJob> {
    const capabilities = await this.gateway.capabilities();
    assertDraftPublishingAvailable(capabilities);
    const session = await this.repository.getActiveSession();
    if (!session) {
      throw new GatewayError('publish_session_missing', false);
    }
    const existing = await this.repository.getLatestPublishJobForSession(session.sessionId);
    if (existing) {
      return this.drive(existing.jobId);
    }
    const choices = await loadCollectionChoices(this.gateway, this.managedDefaultCollectionId);
    const selectedCollectionId = collectionId ?? choices.collections[0]?.collectionId;
    if (!selectedCollectionId) {
      throw new GatewayError('collection_selection_required', false);
    }
    if (
      !choices.collections.some((collection) => collection.collectionId === selectedCollectionId)
    ) {
      throw new GatewayError('collection_not_available', false);
    }
    const job = await this.publisher.enqueue(session, { collectionId: selectedCollectionId });
    return this.drive(job.jobId);
  }

  async publishInternal(jobId: string): Promise<AtriumCapturePublishJob> {
    const job = await this.publisher.requestInternalPublication(jobId);
    await this.markSubmitted(job);
    return job;
  }

  async resume(jobId: string): Promise<AtriumCapturePublishJob> {
    return this.drive(jobId);
  }

  async resumePending(): Promise<void> {
    const capabilities = await this.gateway.capabilities();
    if (!draftPublishingAvailable(capabilities)) {
      return;
    }
    const jobs = await this.repository.listPublishJobs();
    for (const job of jobs) {
      if (
        job.phase !== Phase.Complete &&
        job.phase !== Phase.ReadyAsDraft &&
        job.phase !== Phase.NeedsAttention
      ) {
        await this.drive(job.jobId);
      }
    }
  }

  private async drive(jobId: string): Promise<AtriumCapturePublishJob> {
    const job = await this.publisher.resume(jobId);
    await this.markSubmitted(job);
    return job;
  }

  private async markSubmitted(job: AtriumCapturePublishJob): Promise<void> {
    if (job.phase === Phase.ReadyAsDraft || job.phase === Phase.Complete) {
      await this.repository.markSessionSubmitted(job.sessionId);
    }
  }
}

function assertDraftPublishingAvailable(capabilities: AtriumCapabilities): void {
  if (!draftPublishingAvailable(capabilities)) {
    throw new GatewayError('draft_publishing_unavailable', false);
  }
}

function draftPublishingAvailable(capabilities: AtriumCapabilities): boolean {
  return (
    capabilities.idempotentWrites &&
    capabilities.immutableAssets &&
    (capabilities.mode === 'mock' || capabilities.oauth)
  );
}
