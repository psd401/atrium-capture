import { AssetState, type AtriumCaptureSession } from '@atrium-capture/contracts';
import { SerialTaskQueue } from '@atrium-capture/capture-core';
import { canFinalizeReview, type EditorCommand } from '@atrium-capture/editor-model';

import { CaptureRepository, type PreparedScreenshot, type RawImageRetention } from './database.js';
import { flattenImage, type FlattenImageOptions } from './image-renderer.js';

type ImageFlattener = (source: Blob, options: FlattenImageOptions) => Promise<PreparedScreenshot>;

export class EditorService {
  private readonly queue = new SerialTaskQueue();

  constructor(
    private readonly repository: CaptureRepository,
    private readonly onChanged: () => Promise<void>,
    private readonly flatten: ImageFlattener = flattenImage,
    private readonly idFactory: () => string = () => crypto.randomUUID(),
  ) {}

  command(commandId: string, command: EditorCommand): Promise<AtriumCaptureSession> {
    return this.queue.enqueue(async () => {
      const session = await this.repository.applyEditorCommand(commandId, command);
      await this.onChanged();
      return session;
    });
  }

  finalize(commandId: string, rawRetention: RawImageRetention): Promise<AtriumCaptureSession> {
    return this.queue.enqueue(async () => {
      const existing = await this.repository.getEditorCommandReceipt(commandId);
      const session = await this.repository.getActiveSession();
      if (!session) {
        throw new Error('session_not_found');
      }
      if (existing) {
        return session;
      }
      if (!canFinalizeReview(session)) {
        throw new Error('privacy_review_incomplete');
      }

      const derivatives = [];
      for (const step of session.steps) {
        if (!step.screenshotAssetId) {
          continue;
        }
        const sourceAsset = session.assets.find(
          (asset) => asset.assetId === step.screenshotAssetId,
        );
        if (
          !sourceAsset ||
          (sourceAsset.state !== AssetState.RawLocal &&
            sourceAsset.state !== AssetState.RedactedLocal &&
            sourceAsset.state !== AssetState.PublishableLocal)
        ) {
          throw new Error('raw_asset_unavailable');
        }
        if (sourceAsset.state === AssetState.PublishableLocal) {
          continue;
        }
        const stored = await this.repository.getStoredAsset(sourceAsset.assetId);
        if (!stored) {
          throw new Error('raw_asset_unavailable');
        }
        const prepared = await this.flatten(stored.blob, {
          ...(step.annotations ? { annotations: step.annotations } : {}),
          ...(step.crop ? { crop: step.crop } : {}),
        });
        const assetId = this.idFactory();
        derivatives.push({
          assetId,
          localKey: `sessions/${session.sessionId}/publishable/${assetId}.png`,
          prepared,
          sourceAssetId: sourceAsset.assetId,
          stepId: step.stepId,
        });
      }

      const finalized = await this.repository.finalizeReview(
        commandId,
        session.revision,
        derivatives,
        rawRetention,
      );
      await this.onChanged();
      return finalized;
    });
  }

  async assetDataUrl(assetId: string): Promise<string | undefined> {
    const session = await this.repository.getActiveSession();
    const asset = session?.assets.find((candidate) => candidate.assetId === assetId);
    if (!asset || asset.state === AssetState.Deleted) {
      return undefined;
    }
    const stored = await this.repository.getStoredAsset(assetId);
    if (!stored) {
      return undefined;
    }
    const bytes = new Uint8Array(await stored.blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32_768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    }
    return `data:${stored.blob.type || asset.mimeType};base64,${btoa(binary)}`;
  }
}
