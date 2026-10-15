// ABOUTME: Runs the district Capture Guide Writer assistant over the reviewed session and
// ABOUTME: applies the validated suggestion through the editor, under managed policy.
import { GatewayError, type AtriumGateway } from '@atrium-capture/atrium-client';
import type { AtriumCaptureSession } from '@atrium-capture/contracts';
import { canFinalizeReview } from '@atrium-capture/editor-model';
import {
  GuideSuggestionError,
  applyGuideSuggestion,
  buildGuideWriterRequest,
  parseGuideSuggestionText,
  serializeGuideWriterRequest,
  validateGuideSuggestion,
} from '@atrium-capture/guide-writer';

import type { CaptureRepository } from './database.js';
import type { EditorService } from './editor-service.js';
import type { ManagedPolicySnapshot } from './managed-policy.js';

export type GuideWriterAvailability =
  | { available: true }
  | { available: false; reason: 'assistant_unconfigured' | 'gateway_unavailable' | 'policy_off' };

export type GuideWriterOutcome =
  | { ok: true; session: AtriumCaptureSession }
  | { errorCode: string; ok: false; retryable: boolean };

export class GuideWriterService {
  private forbiddenForSession = false;

  constructor(
    private readonly repository: CaptureRepository,
    private readonly editor: EditorService,
    private readonly gateway: AtriumGateway,
    private readonly policy: () => Promise<ManagedPolicySnapshot>,
  ) {}

  async availability(): Promise<GuideWriterAvailability> {
    const snapshot = await this.policy();
    if (!snapshot.valid || snapshot.policy.aiGuideWriting === 'off' || this.forbiddenForSession) {
      return { available: false, reason: 'policy_off' };
    }
    if (!snapshot.policy.atriumGuideWriterAssistantId) {
      return { available: false, reason: 'assistant_unconfigured' };
    }
    if (!(await this.gateway.capabilities()).guideWriter) {
      return { available: false, reason: 'gateway_unavailable' };
    }
    return { available: true };
  }

  async write(commandId: string): Promise<GuideWriterOutcome> {
    const availability = await this.availability();
    if (!availability.available) {
      return { errorCode: availability.reason, ok: false, retryable: false };
    }
    const snapshot = await this.policy();
    const assistantId = snapshot.policy.atriumGuideWriterAssistantId as number;
    const session = await this.repository.getActiveSession();
    if (!session) {
      return { errorCode: 'session_not_found', ok: false, retryable: false };
    }
    if (!canFinalizeReview(session)) {
      return { errorCode: 'privacy_review_incomplete', ok: false, retryable: false };
    }

    let steps: string;
    try {
      steps = serializeGuideWriterRequest(buildGuideWriterRequest(session));
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : 'guide_request_failed', false);
    }

    let text: string;
    try {
      ({ text } = await this.gateway.executeGuideWriter({ assistantId, steps }));
    } catch (error) {
      if (error instanceof GatewayError) {
        if (error.code === 'atrium_http_403' || error.code === 'insufficient_scope') {
          this.forbiddenForSession = true;
        }
        return this.failure(error.code, error.retryable);
      }
      return this.failure('guide_writer_failed', true);
    }

    let commands;
    try {
      const current = (await this.repository.getActiveSession()) ?? session;
      if (current.sessionId !== session.sessionId) {
        return this.failure('session_changed', false);
      }
      commands = applyGuideSuggestion(
        current,
        validateGuideSuggestion(parseGuideSuggestionText(text), current),
      );
    } catch (error) {
      const code = error instanceof GuideSuggestionError ? error.code : 'suggestion_invalid';
      return this.failure(code, true);
    }

    let updated = session;
    for (const [index, command] of commands.entries()) {
      updated = await this.editor.command(`${commandId}:${index}`, command);
    }
    return { ok: true, session: updated };
  }

  private async failure(errorCode: string, retryable: boolean): Promise<GuideWriterOutcome> {
    await this.repository
      .recordHealthEvent('guide_writer_failed', 'warning')
      .catch(() => undefined);
    return { errorCode, ok: false, retryable };
  }
}
