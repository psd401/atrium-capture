import {
  Action,
  AtriumCaptureSessionState,
  Kind,
  PrivacyReview,
  ReviewStatus,
  Source,
  type AnnotationElement,
  type AtriumCaptureSession,
  type Geometry,
  type StepElement,
} from '@atrium-capture/contracts';

export type EditorCommand =
  | { kind: 'begin_review' }
  | { kind: 'update_title'; title: string }
  | { kind: 'update_instruction'; stepId: string; text: string }
  | { kind: 'move_step'; stepId: string; toIndex: number }
  | { kind: 'delete_step'; stepId: string }
  | { kind: 'merge_step'; stepId: string; withStepId: string }
  | { afterStepId?: string; kind: 'insert_step'; text: string }
  | { crop: Geometry | null; kind: 'set_crop'; stepId: string }
  | { annotation: AnnotationElement; kind: 'add_annotation'; stepId: string }
  | { annotationId: string; kind: 'remove_annotation'; stepId: string }
  | { kind: 'approve_clear_steps' }
  | { kind: 'approve_step'; stepId: string };

export interface EditorContext {
  idFactory?: () => string;
  now?: Date;
}

export interface SensitiveRegionFlag {
  geometry?: Geometry;
  reason: 'input_intent' | 'capture_flag';
  screenshotAssetId?: string;
  stepId: string;
}

export interface ReviewIssue {
  code: 'step_not_approved' | 'sensitive_region_unredacted';
  stepId: string;
}

const defaultIdFactory = (): string => crypto.randomUUID();

export function applyEditorCommand(
  session: AtriumCaptureSession,
  command: EditorCommand,
  context: EditorContext = {},
): AtriumCaptureSession {
  const now = context.now ?? new Date();
  const idFactory = context.idFactory ?? defaultIdFactory;

  if (command.kind === 'update_title') {
    const title = command.title.trim();
    if (!title || title.length > 500) {
      throw new Error('invalid_title');
    }
    return {
      ...session,
      revision: session.revision + 1,
      title,
      updatedAt: now,
    };
  }

  if (command.kind === 'insert_step') {
    assertComposable(session);
  } else {
    assertEditable(session);
  }
  switch (command.kind) {
    case 'begin_review':
      return changed(session, session.steps, now);
    case 'update_instruction': {
      const text = command.text.trim();
      if (!text || text.length > 2_000) {
        throw new Error('invalid_instruction');
      }
      return mapStep(session, command.stepId, now, (step) => ({
        ...step,
        instruction: {
          ...step.instruction,
          editedText: text,
          source: Source.User,
          userEdited: true,
        },
      }));
    }
    case 'move_step': {
      const fromIndex = requireStepIndex(session, command.stepId);
      if (
        !Number.isInteger(command.toIndex) ||
        command.toIndex < 0 ||
        command.toIndex >= session.steps.length
      ) {
        throw new Error('invalid_step_index');
      }
      const steps = [...session.steps];
      const [step] = steps.splice(fromIndex, 1);
      if (!step) {
        throw new Error('step_not_found');
      }
      steps.splice(command.toIndex, 0, step);
      return changed(session, resequence(steps), now);
    }
    case 'delete_step': {
      requireStepIndex(session, command.stepId);
      return changed(
        session,
        resequence(session.steps.filter((step) => step.stepId !== command.stepId)),
        now,
      );
    }
    case 'merge_step': {
      const leftIndex = requireStepIndex(session, command.stepId);
      const rightIndex = requireStepIndex(session, command.withStepId);
      if (Math.abs(leftIndex - rightIndex) !== 1) {
        throw new Error('merge_requires_adjacent_steps');
      }
      const firstIndex = Math.min(leftIndex, rightIndex);
      const secondIndex = Math.max(leftIndex, rightIndex);
      const first = session.steps[firstIndex];
      const second = session.steps[secondIndex];
      if (!first || !second) {
        throw new Error('step_not_found');
      }
      const merged: StepElement = {
        ...first,
        instruction: {
          editedText: `${instructionText(first)}\n${instructionText(second)}`,
          generatedText: first.instruction.generatedText,
          source: Source.User,
          userEdited: true,
        },
        privacyReview:
          first.privacyReview === PrivacyReview.Flagged ||
          second.privacyReview === PrivacyReview.Flagged
            ? PrivacyReview.Flagged
            : PrivacyReview.NotReviewed,
        ...(first.annotations || second.annotations
          ? { annotations: [...(first.annotations ?? []), ...(second.annotations ?? [])] }
          : {}),
        ...(!first.crop && second.crop ? { crop: second.crop } : {}),
        ...(!first.screenshotAssetId && second.screenshotAssetId
          ? { screenshotAssetId: second.screenshotAssetId }
          : {}),
      };
      const steps = [...session.steps];
      steps.splice(firstIndex, 2, merged);
      return changed(session, resequence(steps), now);
    }
    case 'insert_step': {
      const text = command.text.trim();
      if (!text || text.length > 2_000) {
        throw new Error('invalid_instruction');
      }
      const insertIndex = command.afterStepId
        ? requireStepIndex(session, command.afterStepId) + 1
        : session.steps.length;
      const step: StepElement = {
        action: Action.Manual,
        instruction: {
          editedText: text,
          generatedText: text,
          source: Source.User,
          userEdited: true,
        },
        occurredAt: now,
        privacyReview: PrivacyReview.NotReviewed,
        sequence: insertIndex,
        stepId: idFactory(),
      };
      const steps = [...session.steps];
      steps.splice(insertIndex, 0, step);
      return changed(session, resequence(steps), now);
    }
    case 'set_crop':
      if (command.crop) {
        assertGeometry(command.crop);
      }
      return mapStep(session, command.stepId, now, (step) => {
        if (command.crop) {
          return { ...step, crop: command.crop };
        }
        const withoutCrop = { ...step };
        delete withoutCrop.crop;
        return withoutCrop;
      });
    case 'add_annotation':
      assertAnnotation(command.annotation);
      return mapStep(session, command.stepId, now, (step) => ({
        ...step,
        annotations: [
          ...(step.annotations ?? []).filter(
            (annotation) => annotation.id !== command.annotation.id,
          ),
          command.annotation,
        ],
        privacyReview:
          step.privacyReview === PrivacyReview.Approved
            ? PrivacyReview.NotReviewed
            : step.privacyReview,
      }));
    case 'remove_annotation':
      return mapStep(session, command.stepId, now, (step) => ({
        ...step,
        annotations: (step.annotations ?? []).filter(
          (annotation) => annotation.id !== command.annotationId,
        ),
        privacyReview:
          step.privacyReview === PrivacyReview.Approved
            ? PrivacyReview.NotReviewed
            : step.privacyReview,
      }));
    case 'approve_clear_steps':
      return changed(
        session,
        session.steps.map((step) =>
          !requiresPermanentRedaction(step) || hasCoveringRedaction(step)
            ? { ...step, privacyReview: PrivacyReview.Approved }
            : step,
        ),
        now,
      );
    case 'approve_step': {
      const step = session.steps[requireStepIndex(session, command.stepId)];
      if (!step) {
        throw new Error('step_not_found');
      }
      if (requiresPermanentRedaction(step) && !hasCoveringRedaction(step)) {
        throw new Error('sensitive_region_requires_redaction');
      }
      return mapStep(session, command.stepId, now, (candidate) => ({
        ...candidate,
        privacyReview: PrivacyReview.Approved,
      }));
    }
  }
}

export function sensitiveRegionFlags(session: AtriumCaptureSession): SensitiveRegionFlag[] {
  return session.steps.flatMap((step) => {
    if (!isSensitiveStep(step)) {
      return [];
    }
    const geometry = step.target?.bounds
      ? scaleGeometry(
          step.target.bounds,
          step.target.browser?.devicePixelRatio ?? step.target.macos?.backingScaleFactor ?? 1,
        )
      : undefined;
    return [
      {
        reason: step.action === Action.Input ? 'input_intent' : 'capture_flag',
        stepId: step.stepId,
        ...(geometry ? { geometry } : {}),
        ...(step.screenshotAssetId ? { screenshotAssetId: step.screenshotAssetId } : {}),
      } satisfies SensitiveRegionFlag,
    ];
  });
}

export function reviewIssues(session: AtriumCaptureSession): ReviewIssue[] {
  return session.steps.flatMap((step) => {
    const issues: ReviewIssue[] = [];
    if (requiresPermanentRedaction(step) && !hasCoveringRedaction(step)) {
      issues.push({ code: 'sensitive_region_unredacted', stepId: step.stepId });
    }
    if (step.privacyReview !== PrivacyReview.Approved) {
      issues.push({ code: 'step_not_approved', stepId: step.stepId });
    }
    return issues;
  });
}

export function canFinalizeReview(session: AtriumCaptureSession): boolean {
  return session.state === AtriumCaptureSessionState.Review && reviewIssues(session).length === 0;
}

function changed(
  session: AtriumCaptureSession,
  steps: StepElement[],
  now: Date,
): AtriumCaptureSession {
  return {
    ...session,
    policy: { ...session.policy, reviewStatus: ReviewStatus.InReview },
    revision: session.revision + 1,
    state: AtriumCaptureSessionState.Review,
    steps,
    updatedAt: now,
  };
}

function mapStep(
  session: AtriumCaptureSession,
  stepId: string,
  now: Date,
  update: (step: StepElement) => StepElement,
): AtriumCaptureSession {
  requireStepIndex(session, stepId);
  return changed(
    session,
    session.steps.map((step) => (step.stepId === stepId ? update(step) : step)),
    now,
  );
}

function assertEditable(session: AtriumCaptureSession): void {
  if (session.state !== AtriumCaptureSessionState.Review) {
    throw new Error('session_not_editable');
  }
}

function assertComposable(session: AtriumCaptureSession): void {
  if (
    session.state !== AtriumCaptureSessionState.Review &&
    session.state !== AtriumCaptureSessionState.Publishable
  ) {
    throw new Error('session_not_editable');
  }
}

function requireStepIndex(session: AtriumCaptureSession, stepId: string): number {
  const index = session.steps.findIndex((step) => step.stepId === stepId);
  if (index < 0) {
    throw new Error('step_not_found');
  }
  return index;
}

function resequence(steps: StepElement[]): StepElement[] {
  return steps.map((step, sequence) => ({ ...step, sequence }));
}

function instructionText(step: StepElement): string {
  return step.instruction.editedText ?? step.instruction.generatedText;
}

function isSensitiveStep(step: StepElement): boolean {
  return step.action === Action.Input || step.privacyReview === PrivacyReview.Flagged;
}

function requiresPermanentRedaction(step: StepElement): boolean {
  return isSensitiveStep(step) && Boolean(step.screenshotAssetId);
}

function hasCoveringRedaction(step: StepElement): boolean {
  const redactions = (step.annotations ?? []).filter(
    (annotation) => annotation.kind === Kind.Redaction,
  );
  if (redactions.length === 0) {
    return false;
  }
  const flag = step.target?.bounds
    ? scaleGeometry(
        step.target.bounds,
        step.target.browser?.devicePixelRatio ?? step.target.macos?.backingScaleFactor ?? 1,
      )
    : undefined;
  return !flag || redactions.some((annotation) => covers(annotation.geometry, flag));
}

function covers(outer: Geometry, inner: Geometry): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

function scaleGeometry(geometry: Geometry, factor: number): Geometry {
  return {
    height: geometry.height * factor,
    width: geometry.width * factor,
    x: geometry.x * factor,
    y: geometry.y * factor,
  };
}

function assertAnnotation(annotation: AnnotationElement): void {
  assertGeometry(annotation.geometry);
  if (annotation.kind !== Kind.Arrow && annotation.arrowDirection !== undefined) {
    throw new Error('arrow_direction_requires_arrow');
  }
  if (annotation.kind === Kind.Text && !annotation.text?.trim()) {
    throw new Error('text_annotation_requires_text');
  }
  if (annotation.text && annotation.text.length > 1_000) {
    throw new Error('annotation_text_too_long');
  }
  if (annotation.color && !/^#[0-9A-Fa-f]{6}$/.test(annotation.color)) {
    throw new Error('invalid_annotation_color');
  }
}

function assertGeometry(geometry: Geometry): void {
  if (
    ![geometry.x, geometry.y, geometry.width, geometry.height].every(Number.isFinite) ||
    geometry.width <= 0 ||
    geometry.height <= 0
  ) {
    throw new Error('invalid_geometry');
  }
}
