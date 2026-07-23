import {
  Action,
  AtriumCaptureSessionState,
  PrivacyReview,
  ReviewStatus,
  SchemaVersion,
  Source,
  SourceURLRetention,
  Surface,
  type AtriumCaptureSession,
  type StepElement,
  type Target,
} from '@atrium-capture/contracts';

export interface NormalizedCaptureEvent {
  action: Action;
  eventId: string;
  occurredAt: Date;
  shortcut?: string;
  target?: Target;
}

export type RecorderCommand = 'pause' | 'resume' | 'stop';
export type EventDisposition = 'recorded' | 'merged' | 'ignored';

export interface EventReduction {
  disposition: EventDisposition;
  session: AtriumCaptureSession;
  stepId?: string;
}

export interface CreateSessionOptions {
  appVersion: string;
  idFactory?: () => string;
  now?: Date;
  title: string;
}

const defaultIdFactory = (): string => crypto.randomUUID();

export function createCaptureSession(options: CreateSessionOptions): AtriumCaptureSession {
  const now = options.now ?? new Date();
  const idFactory = options.idFactory ?? defaultIdFactory;

  return {
    assets: [],
    createdAt: now,
    policy: {
      policyVersion: 'default-v1',
      reviewStatus: ReviewStatus.NotReviewed,
      sourceUrlRetention: SourceURLRetention.Origin,
    },
    recorder: {
      appVersion: options.appVersion,
      surface: Surface.Browser,
    },
    revision: 0,
    schemaVersion: SchemaVersion.The10,
    sessionId: idFactory(),
    state: AtriumCaptureSessionState.Recording,
    steps: [],
    title: options.title,
    updatedAt: now,
  };
}

export function transitionSession(
  session: AtriumCaptureSession,
  command: RecorderCommand,
  now = new Date(),
): AtriumCaptureSession {
  const nextState = transitionState(session.state, command);
  if (nextState === session.state) {
    return session;
  }

  return {
    ...session,
    revision: session.revision + 1,
    state: nextState,
    updatedAt: now,
  };
}

function transitionState(
  state: AtriumCaptureSessionState,
  command: RecorderCommand,
): AtriumCaptureSessionState {
  if (command === 'pause' && state === AtriumCaptureSessionState.Recording) {
    return AtriumCaptureSessionState.Paused;
  }
  if (command === 'resume' && state === AtriumCaptureSessionState.Paused) {
    return AtriumCaptureSessionState.Recording;
  }
  if (
    command === 'stop' &&
    (state === AtriumCaptureSessionState.Recording || state === AtriumCaptureSessionState.Paused)
  ) {
    return AtriumCaptureSessionState.Review;
  }
  return state;
}

export function reduceCaptureEvent(
  session: AtriumCaptureSession,
  event: NormalizedCaptureEvent,
  idFactory: () => string = defaultIdFactory,
): EventReduction {
  if (session.state !== AtriumCaptureSessionState.Recording) {
    return { disposition: 'ignored', session };
  }

  const previous = session.steps.at(-1);
  const delta = previous ? event.occurredAt.getTime() - previous.occurredAt.getTime() : undefined;

  if (previous && delta !== undefined && delta >= 0 && sameTarget(previous.target, event.target)) {
    if (previous.action === event.action && isDiscardableDuplicate(event.action, delta)) {
      return { disposition: 'merged', session, stepId: previous.stepId };
    }

    if (previous.action === Action.Input && event.action === Action.Input && delta <= 1_250) {
      const updatedStep = {
        ...previous,
        ...makeStep(event, previous.sequence, previous.stepId),
      };
      const updatedSession = {
        ...session,
        revision: session.revision + 1,
        steps: [...session.steps.slice(0, -1), updatedStep],
        updatedAt: event.occurredAt,
      };
      return { disposition: 'merged', session: updatedSession, stepId: previous.stepId };
    }
  }

  const step = makeStep(event, session.steps.length, idFactory());
  return {
    disposition: 'recorded',
    session: {
      ...session,
      revision: session.revision + 1,
      steps: [...session.steps, step],
      updatedAt: event.occurredAt,
    },
    stepId: step.stepId,
  };
}

function isDiscardableDuplicate(action: Action, deltaMilliseconds: number): boolean {
  if (action === Action.Click) {
    return deltaMilliseconds <= 400;
  }
  if (action === Action.Navigate) {
    return deltaMilliseconds <= 1_000;
  }
  return false;
}

function sameTarget(left?: Target, right?: Target): boolean {
  return (
    left?.role === right?.role &&
    left?.accessibleName === right?.accessibleName &&
    left?.browser?.origin === right?.browser?.origin &&
    left?.browser?.path === right?.browser?.path
  );
}

function makeStep(event: NormalizedCaptureEvent, sequence: number, stepId: string): StepElement {
  const step: StepElement = {
    action: event.action,
    instruction: {
      generatedText: instructionFor(event),
      source: Source.Rules,
      userEdited: false,
    },
    occurredAt: event.occurredAt,
    privacyReview:
      event.action === Action.Input ? PrivacyReview.Flagged : PrivacyReview.NotReviewed,
    sequence,
    stepId,
  };

  if (event.target) {
    step.target = event.target;
  }

  return step;
}

function instructionFor(event: NormalizedCaptureEvent): string {
  const name = event.target?.accessibleName?.trim();
  switch (event.action) {
    case Action.Click:
      return name ? `Select ${name}.` : 'Select the indicated control.';
    case Action.Input:
      return name ? `Enter the requested value in ${name}.` : 'Enter the requested value.';
    case Action.Select:
      return name ? `Choose an option in ${name}.` : 'Choose the requested option.';
    case Action.Submit:
      return name ? `Submit ${name}.` : 'Submit the form.';
    case Action.Shortcut:
      return event.shortcut ? `Use the ${event.shortcut} keyboard shortcut.` : 'Use the shortcut.';
    case Action.Navigate:
      return event.target?.browser?.pageTitle
        ? `Continue to ${event.target.browser.pageTitle}.`
        : 'Continue to the next page.';
    case Action.Drag:
      return name ? `Drag ${name}.` : 'Drag the indicated item.';
    case Action.Scroll:
      return 'Scroll to the indicated content.';
    case Action.Manual:
      return 'Complete the described step.';
  }
}

export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
