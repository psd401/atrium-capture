import { AssetState } from '@atrium-capture/contracts';

import { CaptureRepository } from './database.js';
import type { ManagedPolicyProvider } from './managed-policy.js';
import type { BrowserPublicationService } from './publication-service.js';

export interface PlatformSummary {
  arch: string;
  os: string;
}

export interface SupportDiagnostics {
  application: {
    extensionId: string;
    platform: PlatformSummary;
    version: string;
  };
  capture: {
    assetStates: Record<string, number>;
    revision?: number;
    state: string;
    stepCount: number;
  };
  generatedAt: string;
  health: {
    events: Array<{ code: string; occurredAt: string; severity: string }>;
  };
  managedPolicy: {
    allowedOriginCount: number;
    configured: boolean;
    defaultCollectionConfigured: boolean;
    deniedOriginCount: number;
    issues: string[];
    maxSessionSteps: number;
    maxStorageBytes: number;
    rawImageRetention: string;
    sourceUrlRetention: string;
    valid: boolean;
  };
  privacy: {
    captureContentIncluded: false;
    telemetryEnabled: false;
  };
  publication: {
    attemptCount?: number;
    capabilities: {
      collectionDiscovery: boolean;
      idempotentWrites: boolean;
      immutableAssets: boolean;
      internalPublication: boolean;
      oauth: boolean;
    };
    lastErrorCode?: string;
    mode: string;
    phase?: string;
  };
  schemaVersion: 1;
  storage: {
    assetBytes: number;
    assetCount: number;
    publishJobCount: number;
    sessionCount: number;
  };
}

export class DiagnosticsService {
  constructor(
    private readonly repository: CaptureRepository,
    private readonly managedPolicy: ManagedPolicyProvider,
    private readonly publication: BrowserPublicationService,
    private readonly application: {
      extensionId: string;
      platform(): Promise<PlatformSummary>;
      version: string;
    },
    private readonly now: () => Date = () => new Date(),
  ) {}

  async snapshot(): Promise<SupportDiagnostics> {
    const [session, storage, managed, publication, platform, healthEvents] = await Promise.all([
      this.repository.getActiveSession(),
      this.repository.storageSummary(),
      this.managedPolicy.load(),
      this.publication.snapshot(),
      this.application.platform(),
      this.repository.listHealthEvents(),
    ]);
    const assetStates: Record<string, number> = {};
    for (const state of Object.values(AssetState)) {
      const count = session?.assets.filter((asset) => asset.state === state).length ?? 0;
      if (count > 0) {
        assetStates[state] = count;
      }
    }
    return {
      application: {
        extensionId: this.application.extensionId,
        platform,
        version: this.application.version,
      },
      capture: {
        assetStates,
        state: session?.state ?? 'none',
        stepCount: session?.steps.length ?? 0,
        ...(session ? { revision: session.revision } : {}),
      },
      generatedAt: this.now().toISOString(),
      health: {
        events: healthEvents.map(({ code, occurredAt, severity }) => ({
          code,
          occurredAt,
          severity,
        })),
      },
      managedPolicy: {
        allowedOriginCount: managed.policy.allowedOrigins?.length ?? 0,
        configured: managed.configured,
        defaultCollectionConfigured: Boolean(managed.policy.defaultCollectionId),
        deniedOriginCount: managed.policy.deniedOrigins?.length ?? 0,
        issues: managed.issues.map(sanitizePolicyIssue),
        maxSessionSteps: managed.policy.maxSessionSteps,
        maxStorageBytes: managed.policy.maxStorageBytes,
        rawImageRetention: managed.policy.rawImageRetention,
        sourceUrlRetention: managed.policy.sourceUrlRetention,
        valid: managed.valid,
      },
      privacy: { captureContentIncluded: false, telemetryEnabled: false },
      publication: {
        capabilities: {
          collectionDiscovery: publication.capabilities.collectionDiscovery,
          idempotentWrites: publication.capabilities.idempotentWrites,
          immutableAssets: publication.capabilities.immutableAssets,
          internalPublication: publication.capabilities.internalPublication,
          oauth: publication.capabilities.oauth,
        },
        mode: publication.capabilities.mode,
        ...(publication.job ? { attemptCount: publication.job.attemptCount } : {}),
        ...(publication.job?.lastError ? { lastErrorCode: publication.job.lastError.code } : {}),
        ...(publication.job ? { phase: publication.job.phase } : {}),
      },
      schemaVersion: 1,
      storage,
    };
  }
}

function sanitizePolicyIssue(issue: string): string {
  return issue.startsWith('unknown_key:') ? 'unknown_key' : issue;
}
