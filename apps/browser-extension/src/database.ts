import {
  AssetState,
  AtriumCaptureSessionState,
  MIMEType,
  RawImageRetention as ContractRawImageRetention,
  ReviewStatus,
  SourceURLRetention,
  type AssetElement,
  type AtriumCapturePublishJob,
  type AtriumCaptureSession,
} from '@atrium-capture/contracts';
import {
  createCaptureSession,
  reduceCaptureEvent,
  transitionSession,
  type EventDisposition,
  type NormalizedCaptureEvent,
  type RecorderCommand,
} from '@atrium-capture/capture-core';
import {
  applyEditorCommand as reduceEditorCommand,
  canFinalizeReview,
  type EditorCommand,
} from '@atrium-capture/editor-model';
import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';

const activeSessionKey = 'activeSessionId';

export interface PreparedScreenshot {
  blob: Blob;
  mimeType: MIMEType;
  pixelHeight: number;
  pixelWidth: number;
  sha256: string;
}

export interface EventReceipt {
  disposition: EventDisposition;
  eventId: string;
  revision?: number;
  sessionId?: string;
  stepId?: string;
}

export interface StoredAsset {
  assetId: string;
  blob: Blob;
  localKey: string;
}

export interface EditorCommandReceipt {
  commandId: string;
  revision: number;
  sessionId: string;
  type: 'edit' | 'finalize';
}

export interface FinalizeDerivative {
  assetId: string;
  localKey: string;
  prepared: PreparedScreenshot;
  sourceAssetId: string;
  stepId: string;
}

export type RawImageRetention = 'delete_after_flatten' | 'delete_after_submit';

export interface SessionPolicyOptions {
  policyVersion: string;
  rawImageRetention: RawImageRetention;
  sourceUrlRetention: SourceURLRetention;
}

export interface StorageSummary {
  assetBytes: number;
  assetCount: number;
  publishJobCount: number;
  sessionCount: number;
}

export type HealthEventCode =
  | 'capture_paused_quota'
  | 'capture_started'
  | 'capture_state_changed'
  | 'managed_policy_invalid'
  | 'message_handling_failed'
  | 'publication_attention'
  | 'publication_ready'
  | 'publication_retryable'
  | 'screenshot_capture_failed'
  | 'worker_started';

export interface LocalHealthEvent {
  code: HealthEventCode;
  eventId: string;
  occurredAt: string;
  severity: 'error' | 'info' | 'warning';
}

interface MetaRecord {
  key: string;
  value: string;
}

interface CaptureDatabaseSchema extends DBSchema {
  assets: {
    key: string;
    value: StoredAsset;
  };
  commands: {
    key: string;
    value: EditorCommandReceipt;
  };
  healthEvents: {
    indexes: { 'by-occurred-at': string };
    key: string;
    value: LocalHealthEvent;
  };
  meta: {
    key: string;
    value: MetaRecord;
  };
  publishJobs: {
    indexes: { 'by-session': string };
    key: string;
    value: AtriumCapturePublishJob;
  };
  receipts: {
    indexes: { 'by-session': string };
    key: string;
    value: EventReceipt;
  };
  sessions: {
    key: string;
    value: AtriumCaptureSession;
  };
}

export class CaptureRepository {
  private database: Promise<IDBPDatabase<CaptureDatabaseSchema>> | undefined;
  private deleting: Promise<void> | undefined;

  constructor(
    private readonly databaseName = 'atrium-capture-v1',
    private readonly idFactory: () => string = () => crypto.randomUUID(),
  ) {}

  private open(): Promise<IDBPDatabase<CaptureDatabaseSchema>> {
    if (this.deleting) {
      return this.deleting.then(() => this.open());
    }
    this.database ??= openDB<CaptureDatabaseSchema>(this.databaseName, 4, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('assets')) {
          database.createObjectStore('assets', { keyPath: 'assetId' });
        }
        if (!database.objectStoreNames.contains('commands')) {
          database.createObjectStore('commands', { keyPath: 'commandId' });
        }
        if (!database.objectStoreNames.contains('healthEvents')) {
          const health = database.createObjectStore('healthEvents', { keyPath: 'eventId' });
          health.createIndex('by-occurred-at', 'occurredAt');
        }
        if (!database.objectStoreNames.contains('meta')) {
          database.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!database.objectStoreNames.contains('publishJobs')) {
          const publishJobs = database.createObjectStore('publishJobs', { keyPath: 'jobId' });
          publishJobs.createIndex('by-session', 'sessionId');
        }
        if (!database.objectStoreNames.contains('receipts')) {
          const receipts = database.createObjectStore('receipts', { keyPath: 'eventId' });
          receipts.createIndex('by-session', 'sessionId');
        }
        if (!database.objectStoreNames.contains('sessions')) {
          database.createObjectStore('sessions', { keyPath: 'sessionId' });
        }
      },
    });
    return this.database;
  }

  async startSession(
    title: string,
    appVersion: string,
    now = new Date(),
    policy: SessionPolicyOptions = {
      policyVersion: 'local-default-v1',
      rawImageRetention: 'delete_after_flatten',
      sourceUrlRetention: SourceURLRetention.Origin,
    },
  ): Promise<AtriumCaptureSession> {
    const database = await this.open();
    const transaction = database.transaction(['meta', 'sessions'], 'readwrite');
    const metaStore = transaction.objectStore('meta');
    const sessionStore = transaction.objectStore('sessions');
    const active = await metaStore.get(activeSessionKey);

    if (active) {
      const existing = await sessionStore.get(active.value);
      if (existing?.state === 'recording' || existing?.state === 'paused') {
        await transaction.done;
        return existing;
      }
    }

    const created = createCaptureSession({
      appVersion,
      idFactory: this.idFactory,
      now,
      title,
    });
    const session: AtriumCaptureSession = {
      ...created,
      policy: {
        ...created.policy,
        policyVersion: policy.policyVersion,
        rawImageRetention: policy.rawImageRetention as ContractRawImageRetention,
        sourceUrlRetention: policy.sourceUrlRetention,
      },
    };
    await sessionStore.put(session);
    await metaStore.put({ key: activeSessionKey, value: session.sessionId });
    await transaction.done;
    return session;
  }

  async transition(
    command: RecorderCommand,
    now = new Date(),
  ): Promise<AtriumCaptureSession | undefined> {
    const database = await this.open();
    const transaction = database.transaction(['meta', 'sessions'], 'readwrite');
    const active = await transaction.objectStore('meta').get(activeSessionKey);
    if (!active) {
      await transaction.done;
      return undefined;
    }

    const sessionStore = transaction.objectStore('sessions');
    const session = await sessionStore.get(active.value);
    if (!session) {
      await transaction.done;
      return undefined;
    }

    const next = transitionSession(session, command, now);
    if (next !== session) {
      await sessionStore.put(next);
    }
    await transaction.done;
    return next;
  }

  async getActiveSession(): Promise<AtriumCaptureSession | undefined> {
    const database = await this.open();
    const active = await database.get('meta', activeSessionKey);
    return active ? database.get('sessions', active.value) : undefined;
  }

  async getSession(sessionId: string): Promise<AtriumCaptureSession | undefined> {
    return (await this.open()).get('sessions', sessionId);
  }

  async markSessionSubmitted(sessionId: string, now = new Date()): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(['assets', 'sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');
    const session = await store.get(sessionId);
    if (session && session.state === AtriumCaptureSessionState.Publishable) {
      const rawAssetIds = new Set(
        session.assets
          .filter((asset) => asset.state === AssetState.RawLocal)
          .map((asset) => asset.assetId),
      );
      const assetStore = transaction.objectStore('assets');
      for (const assetId of rawAssetIds) {
        await assetStore.delete(assetId);
      }
      await store.put({
        ...session,
        assets: session.assets.map((asset) =>
          rawAssetIds.has(asset.assetId) ? { ...asset, state: AssetState.Deleted } : asset,
        ),
        revision: session.revision + 1,
        state: AtriumCaptureSessionState.Submitted,
        updatedAt: now,
      });
    }
    await transaction.done;
  }

  async getPublishJob(jobId: string): Promise<AtriumCapturePublishJob | undefined> {
    return (await this.open()).get('publishJobs', jobId);
  }

  async getLatestPublishJobForSession(
    sessionId: string,
  ): Promise<AtriumCapturePublishJob | undefined> {
    const jobs = await (await this.open()).getAllFromIndex('publishJobs', 'by-session', sessionId);
    return jobs.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  }

  async listPublishJobs(): Promise<AtriumCapturePublishJob[]> {
    return (await this.open()).getAll('publishJobs');
  }

  async storageSummary(): Promise<StorageSummary> {
    const database = await this.open();
    const transaction = database.transaction(['assets', 'publishJobs', 'sessions'], 'readonly');
    const assetStore = transaction.objectStore('assets');
    let assetBytes = 0;
    let assetCount = 0;
    let cursor = await assetStore.openCursor();
    while (cursor) {
      assetBytes += cursor.value.blob.size;
      assetCount += 1;
      cursor = await cursor.continue();
    }
    const publishJobCount = await transaction.objectStore('publishJobs').count();
    const sessionCount = await transaction.objectStore('sessions').count();
    await transaction.done;
    return { assetBytes, assetCount, publishJobCount, sessionCount };
  }

  async recordHealthEvent(
    code: HealthEventCode,
    severity: LocalHealthEvent['severity'] = 'info',
    now = new Date(),
  ): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction('healthEvents', 'readwrite');
    const store = transaction.objectStore('healthEvents');
    await store.put({
      code,
      eventId: crypto.randomUUID(),
      occurredAt: now.toISOString(),
      severity,
    });
    let excess = (await store.count()) - 100;
    if (excess > 0) {
      let cursor = await store.index('by-occurred-at').openCursor();
      while (cursor && excess > 0) {
        await cursor.delete();
        excess -= 1;
        cursor = await cursor.continue();
      }
    }
    await transaction.done;
  }

  async listHealthEvents(limit = 20): Promise<LocalHealthEvent[]> {
    const events = await (await this.open()).getAll('healthEvents');
    return events
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, Math.max(0, Math.min(limit, 100)));
  }

  async putPublishJob(job: AtriumCapturePublishJob): Promise<void> {
    await (await this.open()).put('publishJobs', job);
  }

  async getStoredAsset(assetId: string): Promise<StoredAsset | undefined> {
    return (await this.open()).get('assets', assetId);
  }

  async getEditorCommandReceipt(commandId: string): Promise<EditorCommandReceipt | undefined> {
    return (await this.open()).get('commands', commandId);
  }

  async applyEditorCommand(
    commandId: string,
    command: EditorCommand,
    now = new Date(),
  ): Promise<AtriumCaptureSession> {
    const database = await this.open();
    const transaction = database.transaction(['commands', 'meta', 'sessions'], 'readwrite');
    const commandStore = transaction.objectStore('commands');
    const existing = await commandStore.get(commandId);
    const active = await transaction.objectStore('meta').get(activeSessionKey);
    const sessionStore = transaction.objectStore('sessions');
    const session = active ? await sessionStore.get(active.value) : undefined;
    if (!session) {
      throw new Error('session_not_found');
    }
    if (existing) {
      await transaction.done;
      return session;
    }
    const next = reduceEditorCommand(session, command, { idFactory: this.idFactory, now });
    await sessionStore.put(next);
    await commandStore.put({
      commandId,
      revision: next.revision,
      sessionId: next.sessionId,
      type: 'edit',
    });
    await transaction.done;
    return next;
  }

  async finalizeReview(
    commandId: string,
    expectedRevision: number,
    derivatives: readonly FinalizeDerivative[],
    rawRetention: RawImageRetention,
    now = new Date(),
  ): Promise<AtriumCaptureSession> {
    const database = await this.open();
    const transaction = database.transaction(
      ['assets', 'commands', 'meta', 'sessions'],
      'readwrite',
    );
    const commandStore = transaction.objectStore('commands');
    const existing = await commandStore.get(commandId);
    const active = await transaction.objectStore('meta').get(activeSessionKey);
    const sessionStore = transaction.objectStore('sessions');
    const session = active ? await sessionStore.get(active.value) : undefined;
    if (!session) {
      throw new Error('session_not_found');
    }
    if (existing) {
      await transaction.done;
      return session;
    }
    if (session.revision !== expectedRevision) {
      throw new Error('session_revision_changed');
    }
    if (!canFinalizeReview(session)) {
      throw new Error('privacy_review_incomplete');
    }

    const assetStore = transaction.objectStore('assets');
    const derivedByStep = new Map(derivatives.map((derivative) => [derivative.stepId, derivative]));
    for (const derivative of derivatives) {
      await assetStore.put({
        assetId: derivative.assetId,
        blob: derivative.prepared.blob,
        localKey: derivative.localKey,
      });
    }
    const rawAssetIds = new Set(derivatives.map((derivative) => derivative.sourceAssetId));
    if (rawRetention === 'delete_after_flatten') {
      await Promise.all([...rawAssetIds].map((assetId) => assetStore.delete(assetId)));
    }
    const nextAssets: AssetElement[] = [
      ...session.assets.map((asset) =>
        rawRetention === 'delete_after_flatten' && rawAssetIds.has(asset.assetId)
          ? { ...asset, state: AssetState.Deleted }
          : asset,
      ),
      ...derivatives.map((derivative): AssetElement => ({
        assetId: derivative.assetId,
        derivedFromAssetId: derivative.sourceAssetId,
        localKey: derivative.localKey,
        mimeType: derivative.prepared.mimeType,
        pixelHeight: derivative.prepared.pixelHeight,
        pixelWidth: derivative.prepared.pixelWidth,
        sha256: derivative.prepared.sha256,
        state: AssetState.PublishableLocal,
      })),
    ];
    const next: AtriumCaptureSession = {
      ...session,
      assets: nextAssets,
      policy: {
        ...session.policy,
        rawImageRetention: rawRetention as ContractRawImageRetention,
        reviewStatus: ReviewStatus.Approved,
      },
      revision: session.revision + 1,
      state: AtriumCaptureSessionState.Publishable,
      steps: session.steps.map((step) => {
        const derivative = derivedByStep.get(step.stepId);
        return derivative ? { ...step, screenshotAssetId: derivative.assetId } : step;
      }),
      updatedAt: now,
    };
    await sessionStore.put(next);
    await commandStore.put({
      commandId,
      revision: next.revision,
      sessionId: next.sessionId,
      type: 'finalize',
    });
    await transaction.done;
    return next;
  }

  async applyEvent(
    event: NormalizedCaptureEvent,
    screenshot?: PreparedScreenshot,
  ): Promise<EventReceipt> {
    const database = await this.open();
    const transaction = database.transaction(
      ['assets', 'meta', 'receipts', 'sessions'],
      'readwrite',
    );
    const receiptStore = transaction.objectStore('receipts');
    const existingReceipt = await receiptStore.get(event.eventId);
    if (existingReceipt) {
      await transaction.done;
      return existingReceipt;
    }

    const active = await transaction.objectStore('meta').get(activeSessionKey);
    const sessionStore = transaction.objectStore('sessions');
    const session = active ? await sessionStore.get(active.value) : undefined;
    if (!session) {
      const receipt: EventReceipt = { disposition: 'ignored', eventId: event.eventId };
      await receiptStore.put(receipt);
      await transaction.done;
      return receipt;
    }

    const reduction = reduceCaptureEvent(session, event, this.idFactory);
    let nextSession = reduction.session;

    if (screenshot && reduction.disposition === 'recorded' && reduction.stepId) {
      const assetId = this.idFactory();
      const localKey = `sessions/${session.sessionId}/raw/${assetId}.png`;
      const asset: AssetElement = {
        assetId,
        localKey,
        mimeType: screenshot.mimeType,
        pixelHeight: screenshot.pixelHeight,
        pixelWidth: screenshot.pixelWidth,
        sha256: screenshot.sha256,
        state: AssetState.RawLocal,
      };
      nextSession = {
        ...nextSession,
        assets: [...nextSession.assets, asset],
        steps: nextSession.steps.map((step) =>
          step.stepId === reduction.stepId ? { ...step, screenshotAssetId: assetId } : step,
        ),
      };
      await transaction.objectStore('assets').put({ assetId, blob: screenshot.blob, localKey });
    }

    if (nextSession !== session) {
      await sessionStore.put(nextSession);
    }

    const receipt: EventReceipt = {
      disposition: reduction.disposition,
      eventId: event.eventId,
      revision: nextSession.revision,
      sessionId: session.sessionId,
      ...(reduction.stepId ? { stepId: reduction.stepId } : {}),
    };
    await receiptStore.put(receipt);
    await transaction.done;
    return receipt;
  }

  async close(): Promise<void> {
    if (this.database) {
      (await this.database).close();
      this.database = undefined;
    }
  }

  async deleteAllLocalData(): Promise<void> {
    if (this.deleting) {
      return this.deleting;
    }
    this.deleting = (async () => {
      await this.close();
      await deleteDB(this.databaseName);
    })();
    try {
      await this.deleting;
    } finally {
      this.deleting = undefined;
    }
  }

  async deleteForTests(): Promise<void> {
    await this.deleteAllLocalData();
  }
}
