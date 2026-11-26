// ABOUTME: Builds the metadata-only Capture Guide Writer request, validates the assistant's
// ABOUTME: JSON reply against the shared contract, and converts it into editor commands.
import { normalizeCaptureSourceOriginForPublication } from '@atrium-capture/atrium-client';
import {
  SourceURLRetention,
  type AtriumCaptureGuideSuggestion,
  type AtriumCaptureSession,
  type GuideSuggestionStep,
  type StepElement,
} from '@atrium-capture/contracts';
import type { EditorCommand } from '@atrium-capture/editor-model';

export const GUIDE_WRITER_REQUEST_LIMIT_BYTES = 131_072;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Pinned against `contracts/guide-suggestion.schema.json`; see the schema-drift test in
// `test/guide-writer.test.ts`.
export const GUIDE_SUGGESTION_TITLE_MIN_LENGTH = 1;
export const GUIDE_SUGGESTION_TITLE_MAX_LENGTH = 200;
export const GUIDE_SUGGESTION_SUMMARY_MIN_LENGTH = 1;
export const GUIDE_SUGGESTION_SUMMARY_MAX_LENGTH = 600;
export const GUIDE_SUGGESTION_STEP_TITLE_MIN_LENGTH = 1;
export const GUIDE_SUGGESTION_STEP_TITLE_MAX_LENGTH = 120;
export const GUIDE_SUGGESTION_INSTRUCTION_MIN_LENGTH = 1;
export const GUIDE_SUGGESTION_INSTRUCTION_MAX_LENGTH = 2_000;
export const GUIDE_SUGGESTION_STEPS_MIN_ITEMS = 1;
export const GUIDE_SUGGESTION_STEPS_MAX_ITEMS = 1_000;

export interface GuideWriterRequestStep {
  accessibleName?: string;
  action: string;
  appName?: string;
  instruction: string;
  origin?: string;
  pageTitle?: string;
  role?: string;
  sequence: number;
  stepId: string;
  windowTitle?: string;
}

export interface GuideWriterRequest {
  schemaVersion: 1;
  sessionId: string;
  steps: GuideWriterRequestStep[];
  title: string;
}

export type GuideSuggestionErrorCode =
  | 'suggestion_invalid'
  | 'suggestion_missing_step'
  | 'suggestion_not_json'
  | 'suggestion_session_mismatch'
  | 'suggestion_unknown_step';

export class GuideSuggestionError extends Error {
  constructor(
    public readonly code: GuideSuggestionErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'GuideSuggestionError';
  }
}

export function buildGuideWriterRequest(session: AtriumCaptureSession): GuideWriterRequest {
  const retainOrigin = session.policy.sourceUrlRetention !== SourceURLRetention.None;
  return {
    schemaVersion: 1,
    sessionId: session.sessionId,
    steps: [...session.steps]
      .sort((left, right) => left.sequence - right.sequence)
      .map((step) => requestStep(step, retainOrigin)),
    title: session.title,
  };
}

export function serializeGuideWriterRequest(request: GuideWriterRequest): string {
  const serialized = JSON.stringify(request);
  if (new TextEncoder().encode(serialized).byteLength > GUIDE_WRITER_REQUEST_LIMIT_BYTES) {
    throw new Error('guide_request_too_large');
  }
  return serialized;
}

export function parseGuideSuggestionText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    throw new GuideSuggestionError('suggestion_not_json');
  }
}

export function validateGuideSuggestion(
  value: unknown,
  session: AtriumCaptureSession,
): AtriumCaptureGuideSuggestion {
  const record = requireRecord(value, ['schemaVersion', 'sessionId', 'title', 'summary', 'steps']);
  if (record.schemaVersion !== 1) {
    throw new GuideSuggestionError('suggestion_invalid', 'schemaVersion must be 1');
  }
  const suggestionSessionId = requireText(record.sessionId, 1, 36, 'sessionId');
  if (!UUID_PATTERN.test(suggestionSessionId)) {
    throw new GuideSuggestionError('suggestion_invalid', 'sessionId must be a uuid');
  }
  if (suggestionSessionId !== session.sessionId) {
    throw new GuideSuggestionError('suggestion_session_mismatch');
  }
  const title = requireText(
    record.title,
    GUIDE_SUGGESTION_TITLE_MIN_LENGTH,
    GUIDE_SUGGESTION_TITLE_MAX_LENGTH,
    'title',
  );
  const summary = requireText(
    record.summary,
    GUIDE_SUGGESTION_SUMMARY_MIN_LENGTH,
    GUIDE_SUGGESTION_SUMMARY_MAX_LENGTH,
    'summary',
  );
  if (
    !Array.isArray(record.steps) ||
    record.steps.length < GUIDE_SUGGESTION_STEPS_MIN_ITEMS ||
    record.steps.length > GUIDE_SUGGESTION_STEPS_MAX_ITEMS
  ) {
    throw new GuideSuggestionError('suggestion_invalid', 'steps must be a non-empty array');
  }
  const sessionStepIds = new Set(session.steps.map((step) => step.stepId));
  const seen = new Set<string>();
  const steps = record.steps.map((entry) => {
    const stepRecord = requireRecord(entry, ['stepId', 'title', 'instruction']);
    const stepId = requireText(stepRecord.stepId, 1, 36, 'stepId');
    if (!sessionStepIds.has(stepId) || seen.has(stepId)) {
      throw new GuideSuggestionError(
        'suggestion_unknown_step',
        `unknown or repeated step ${stepId}`,
      );
    }
    seen.add(stepId);
    return {
      instruction: requireText(
        stepRecord.instruction,
        GUIDE_SUGGESTION_INSTRUCTION_MIN_LENGTH,
        GUIDE_SUGGESTION_INSTRUCTION_MAX_LENGTH,
        'instruction',
      ),
      stepId,
      title: requireText(
        stepRecord.title,
        GUIDE_SUGGESTION_STEP_TITLE_MIN_LENGTH,
        GUIDE_SUGGESTION_STEP_TITLE_MAX_LENGTH,
        'step title',
      ),
    };
  });
  for (const stepId of sessionStepIds) {
    if (!seen.has(stepId)) {
      throw new GuideSuggestionError('suggestion_missing_step', `missing step ${stepId}`);
    }
  }
  return {
    schemaVersion: 1,
    sessionId: suggestionSessionId,
    steps: steps as [GuideSuggestionStep, ...GuideSuggestionStep[]],
    summary,
    title,
  };
}

export function applyGuideSuggestion(
  session: AtriumCaptureSession,
  suggestion: AtriumCaptureGuideSuggestion,
): EditorCommand[] {
  const byStepId = new Map(suggestion.steps.map((step) => [step.stepId, step]));
  const commands: EditorCommand[] = [{ kind: 'update_title', title: suggestion.title }];
  for (const step of [...session.steps].sort((left, right) => left.sequence - right.sequence)) {
    const suggested = byStepId.get(step.stepId);
    if (!suggested) {
      throw new GuideSuggestionError('suggestion_missing_step', `missing step ${step.stepId}`);
    }
    commands.push({
      kind: 'suggest_instruction',
      stepId: step.stepId,
      text: suggested.instruction,
      title: suggested.title,
    });
  }
  return commands;
}

function requestStep(step: StepElement, retainOrigin: boolean): GuideWriterRequestStep {
  const browser = step.target?.browser;
  const macos = step.target?.macos;
  const origin =
    retainOrigin && browser?.origin
      ? normalizeCaptureSourceOriginForPublication(browser.origin)
      : undefined;
  return {
    action: step.action,
    instruction: step.instruction.editedText ?? step.instruction.generatedText,
    sequence: step.sequence,
    stepId: step.stepId,
    ...optional('role', step.target?.role),
    ...optional('accessibleName', step.target?.accessibleName),
    ...optional('pageTitle', browser?.pageTitle),
    ...optional('origin', origin),
    ...optional('appName', macos?.appName),
    ...optional('windowTitle', macos?.windowTitle),
  };
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  const trimmed = value?.trim();
  return trimmed ? ({ [key]: trimmed } as Record<K, string>) : {};
}

function requireRecord(value: unknown, allowedKeys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GuideSuggestionError('suggestion_invalid', 'expected an object');
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      throw new GuideSuggestionError('suggestion_invalid', `unexpected property ${key}`);
    }
  }
  for (const key of allowedKeys) {
    if (!(key in record)) {
      throw new GuideSuggestionError('suggestion_invalid', `missing property ${key}`);
    }
  }
  return record;
}

function requireText(value: unknown, min: number, max: number, label: string): string {
  if (typeof value !== 'string') {
    throw new GuideSuggestionError('suggestion_invalid', `${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new GuideSuggestionError('suggestion_invalid', `${label} length out of range`);
  }
  return trimmed;
}
