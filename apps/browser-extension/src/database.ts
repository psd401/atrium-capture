import {
  AssetState,
  MIMEType,
  type AssetElement,
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

interface MetaRecord {
  key: string;
  value: string;
}

interface CaptureDatabaseSchema extends DBSchema {
  assets: {
    key: string;
    value: StoredAsset;
  };
  meta: {
    key: string;
    value: MetaRecord;
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

  constructor(
    private readonly databaseName = 'atrium-capture-v1',
    private readonly idFactory: () => string = () => crypto.randomUUID(),
  ) {}

  private open(): Promise<IDBPDatabase<CaptureDatabaseSchema>> {
    this.database ??= openDB<CaptureDatabaseSchema>(this.databaseName, 1, {
      upgrade(database) {
        database.createObjectStore('assets', { keyPath: 'assetId' });
        database.createObjectStore('meta', { keyPath: 'key' });
        const receipts = database.createObjectStore('receipts', { keyPath: 'eventId' });
        receipts.createIndex('by-session', 'sessionId');
        database.createObjectStore('sessions', { keyPath: 'sessionId' });
      },
    });
    return this.database;
  }

  async startSession(
    title: string,
    appVersion: string,
    now = new Date(),
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

    const session = createCaptureSession({
      appVersion,
      idFactory: this.idFactory,
      now,
      title,
    });
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

  async deleteForTests(): Promise<void> {
    await this.close();
    await deleteDB(this.databaseName);
  }
}
