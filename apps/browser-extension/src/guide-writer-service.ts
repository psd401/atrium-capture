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

type AvailabilityCheck =
  | { available: true; assistantId: number; snapshot: ManagedPolicySnapshot }
  | { available: false; reason: 'assistant_unconfigured' | 'gateway_unavailable' | 'policy_off' };

export class GuideWriterService {
  private forbiddenForSession = false;
  // Single in-flight guard: this service is bound to one CaptureRepository with at most one
  // active session, so a boolean is equivalent to tracking per-session in-flight state, and it
  // is set before any await so a second concurrent write() call always sees it.
  private writeInFlight = false;

  constructor(
    private readonly repository: CaptureRepository,
    private readonly editor: EditorService,
    private readonly gateway: AtriumGateway,
    private readonly policy: () => Promise<ManagedPolicySnapshot>,
  ) {}

  async availability(): Promise<GuideWriterAvailability> {
    const check = await this.checkAvailability();
    return check.available ? { available: true } : check;
  }

  async write(commandId: string): Promise<GuideWriterOutcome> {
    if (this.writeInFlight) {
      return { errorCode: 'write_in_progress', ok: false, retryable: false };
    }
    this.writeInFlight = true;
    try {
      return await this.performWrite(commandId);
    } finally {
      this.writeInFlight = false;
    }
  }

  private async checkAvailability(): Promise<AvailabilityCheck> {
    const snapshot = await this.policy();
    if (!snapshot.valid || snapshot.policy.aiGuideWriting === 'off' || this.forbiddenForSession) {
      return { available: false, reason: 'policy_off' };
    }
    const assistantId = snapshot.policy.atriumGuideWriterAssistantId;
    if (!assistantId) {
      return { available: false, reason: 'assistant_unconfigured' };
    }
    if (!(await this.gateway.capabilities()).guideWriter) {
      return { available: false, reason: 'gateway_unavailable' };
    }
    return { available: true, assistantId, snapshot };
  }

  private async performWrite(commandId: string): Promise<GuideWriterOutcome> {
    const check = await this.checkAvailability();
    if (!check.available) {
      // Pre-gateway gating refusal: policy/configuration state, not a recorded failure.
      return { errorCode: check.reason, ok: false, retryable: false };
    }
    const { assistantId } = check;
    const session = await this.repository.getActiveSession();
    if (!session) {
      return this.failure('session_not_found', false);
    }
    if (!canFinalizeReview(session)) {
      // Pre-gateway gating refusal: review isn't finished, not a recorded failure.
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
      const current = await this.repository.getActiveSession();
      if (!current || current.sessionId !== session.sessionId) {
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

    try {
      let updated = session;
      for (const [index, command] of commands.entries()) {
        updated = await this.editor.command(`${commandId}:${index}`, command);
      }
      return { ok: true, session: updated };
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : 'guide_writer_failed', false);
    }
  }

  private async failure(errorCode: string, retryable: boolean): Promise<GuideWriterOutcome> {
    await this.repository
      .recordHealthEvent('guide_writer_failed', 'warning')
      .catch(() => undefined);
    return { errorCode, ok: false, retryable };
  }
}
