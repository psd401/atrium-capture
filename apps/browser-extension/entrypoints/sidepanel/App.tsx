import {
  AssetState,
  AtriumCaptureSessionState,
  Kind,
  Phase,
  PrivacyReview,
  type AnnotationElement,
  type AtriumCaptureSession,
  type Geometry,
  type StepElement,
} from '@atrium-capture/contracts';
import {
  reviewIssues,
  sensitiveRegionFlags,
  type EditorCommand,
  type ReviewIssue,
} from '@atrium-capture/editor-model';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { browser } from 'wxt/browser';

import { authenticationFailureMessage } from '../../src/authentication-guidance.js';
import {
  parsePublicationFailureResponse,
  publicationFailureMessage,
} from '../../src/publication-guidance.js';
import { arrowEndpoints, directionForArrow } from '../../src/arrow-geometry.js';
import type { PublicationSnapshot } from '../../src/publication-service.js';
import type { SupportDiagnostics } from '../../src/diagnostics-service.js';
import type { NativeBridgeSnapshot } from '../../src/native-bridge-service.js';

const annotationTools = [
  { kind: Kind.Arrow, label: 'Arrow' },
  { kind: Kind.Rectangle, label: 'Rectangle' },
  { kind: Kind.Text, label: 'Text' },
  { kind: Kind.Highlight, label: 'Highlight' },
  { kind: Kind.Blur, label: 'Blur' },
  { kind: Kind.Mosaic, label: 'Mosaic' },
  { kind: Kind.Redaction, label: 'Redact' },
] as const;

type DrawingTool = Kind | 'crop';

export function App() {
  const [session, setSession] = useState<AtriumCaptureSession>();
  const [guides, setGuides] = useState<AtriumCaptureSession[]>([]);
  const [publication, setPublication] = useState<PublicationSnapshot>();
  const [diagnostics, setDiagnostics] = useState<SupportDiagnostics>();
  const [nativeBridge, setNativeBridge] = useState<NativeBridgeSnapshot>();
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedStepId, setSelectedStepId] = useState<string>();
  const [assetDataUrl, setAssetDataUrl] = useState<string>();
  const [tool, setTool] = useState<DrawingTool>();
  const [zoom, setZoom] = useState(1);
  const [titleDraft, setTitleDraft] = useState('');
  const [instructionDraft, setInstructionDraft] = useState('');
  const [manualDraft, setManualDraft] = useState('');
  const [textDraft, setTextDraft] = useState('Note');
  const [drawingStart, setDrawingStart] = useState<{ x: number; y: number }>();
  const imageRef = useRef<HTMLImageElement>(null);

  const refresh = useCallback(async () => {
    const [next, publicationSnapshot, guideList] = await Promise.all([
      browser.runtime.sendMessage({ kind: 'recorder.snapshot' }),
      browser.runtime.sendMessage({ kind: 'publisher.snapshot' }),
      browser.runtime.sendMessage({ kind: 'recorder.list-guides' }),
    ]);
    setSession(next as AtriumCaptureSession | undefined);
    setPublication(publicationSnapshot as PublicationSnapshot | undefined);
    setGuides(guideList as AtriumCaptureSession[]);
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 500);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const refreshDiagnostics = useCallback(async () => {
    const next = await browser.runtime.sendMessage({ kind: 'diagnostics.snapshot' });
    setDiagnostics(next as SupportDiagnostics | undefined);
  }, []);

  useEffect(() => {
    void refreshDiagnostics();
    const interval = window.setInterval(() => void refreshDiagnostics(), 5_000);
    return () => window.clearInterval(interval);
  }, [refreshDiagnostics]);

  const refreshNativeBridge = useCallback(async () => {
    const next = await browser.runtime.sendMessage({ kind: 'native-bridge.snapshot' });
    setNativeBridge(next as NativeBridgeSnapshot | undefined);
  }, []);

  useEffect(() => {
    void refreshNativeBridge();
    const interval = window.setInterval(() => void refreshNativeBridge(), 5_000);
    return () => window.clearInterval(interval);
  }, [refreshNativeBridge]);

  const toggleNativeBridge = useCallback(async () => {
    try {
      const enable = !nativeBridge?.enabled;
      if (enable) {
        const granted = await browser.permissions.request({ permissions: ['nativeMessaging'] });
        if (!granted) {
          setError('Mac enrichment permission was not granted.');
          await refreshNativeBridge();
          return;
        }
      }
      const next = await browser.runtime.sendMessage({
        kind: 'native-bridge.set-enabled',
        payload: { enabled: enable },
      });
      setNativeBridge(next as NativeBridgeSnapshot);
      if (!enable) {
        await browser.permissions.remove({ permissions: ['nativeMessaging'] });
        await refreshNativeBridge();
      }
    } catch {
      setError('Mac enrichment could not be updated.');
    }
  }, [nativeBridge?.enabled, refreshNativeBridge]);

  useEffect(() => {
    if (
      publication?.collections.length &&
      !publication.collections.some(
        (collection) => collection.collectionId === selectedCollectionId,
      )
    ) {
      setSelectedCollectionId(publication.collections[0]?.collectionId ?? '');
    }
  }, [publication, selectedCollectionId]);

  useEffect(() => {
    if (!session?.steps.length) {
      setSelectedStepId(undefined);
      return;
    }
    if (!selectedStepId || !session.steps.some((step) => step.stepId === selectedStepId)) {
      setSelectedStepId(session.steps[0]?.stepId);
    }
  }, [selectedStepId, session]);

  const selectedStep = session?.steps.find((step) => step.stepId === selectedStepId);
  const selectedIndex = selectedStep
    ? (session?.steps.findIndex((step) => step.stepId === selectedStep.stepId) ?? -1)
    : -1;
  const selectedAsset = selectedStep?.screenshotAssetId
    ? session?.assets.find((asset) => asset.assetId === selectedStep.screenshotAssetId)
    : undefined;
  const issues = useMemo(() => (session ? reviewIssues(session) : []), [session]);
  const flags = useMemo(() => (session ? sensitiveRegionFlags(session) : []), [session]);
  const selectedFlag = flags.find((flag) => flag.stepId === selectedStepId);
  const selectedSensitiveIssue = issues.some(
    (issue) => issue.stepId === selectedStepId && issue.code === 'sensitive_region_unredacted',
  );

  useEffect(() => {
    setInstructionDraft(
      selectedStep?.instruction.editedText ?? selectedStep?.instruction.generatedText ?? '',
    );
  }, [selectedStep]);

  useEffect(() => {
    setTitleDraft(session?.title ?? '');
  }, [session?.sessionId, session?.title]);

  useEffect(() => {
    let current = true;
    setAssetDataUrl(undefined);
    if (!selectedAsset || selectedAsset.state === AssetState.Deleted) {
      return () => {
        current = false;
      };
    }
    void browser.runtime
      .sendMessage({ kind: 'editor.asset', payload: { assetId: selectedAsset.assetId } })
      .then((value) => {
        if (current && typeof value === 'string') {
          setAssetDataUrl(value);
        }
      });
    return () => {
      current = false;
    };
  }, [selectedAsset]);

  const recorderCommand = async (command: 'new' | 'start' | 'pause' | 'resume' | 'stop') => {
    setPending(true);
    setError(undefined);
    try {
      const next = (await browser.runtime.sendMessage({
        kind: 'recorder.command',
        payload: { command, commandId: crypto.randomUUID() },
      })) as AtriumCaptureSession | undefined;
      if (!next) {
        throw new Error('recorder_command_failed');
      }
      setSession(next);
    } catch {
      setError('The recorder could not update. Try again.');
    } finally {
      setPending(false);
    }
  };

  const activateGuide = async (sessionId: string) => {
    if (sessionId === session?.sessionId) {
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const next = (await browser.runtime.sendMessage({
        kind: 'recorder.activate-guide',
        payload: { sessionId },
      })) as AtriumCaptureSession | undefined;
      if (!next) {
        throw new Error('activate_guide_failed');
      }
      setSession(next);
      await refresh();
    } catch {
      setError('That saved guide could not be opened.');
    } finally {
      setPending(false);
    }
  };

  const editorCommand = async (
    command: EditorCommand,
  ): Promise<AtriumCaptureSession | undefined> => {
    setPending(true);
    setError(undefined);
    try {
      const next = (await browser.runtime.sendMessage({
        kind: 'editor.command',
        payload: { command, commandId: crypto.randomUUID() },
      })) as AtriumCaptureSession | undefined;
      if (!next) {
        throw new Error('editor_command_failed');
      }
      setSession(next);
      return next;
    } catch {
      setError('That edit could not be saved. Review the step and try again.');
      return undefined;
    } finally {
      setPending(false);
    }
  };

  const finalize = async () => {
    setPending(true);
    setError(undefined);
    try {
      const next = (await browser.runtime.sendMessage({
        kind: 'editor.finalize',
        payload: { commandId: crypto.randomUUID() },
      })) as AtriumCaptureSession | undefined;
      if (!next) {
        throw new Error('finalize_failed');
      }
      setSession(next);
    } catch {
      setError('Publishable images could not be prepared. No source image was uploaded.');
    } finally {
      setPending(false);
    }
  };

  const publisherCommand = async (
    kind: 'publisher.enqueue' | 'publisher.publish-internal' | 'publisher.retry',
  ) => {
    setPending(true);
    setError(undefined);
    try {
      const payload =
        kind === 'publisher.enqueue'
          ? {
              commandId: crypto.randomUUID(),
              ...(selectedCollectionId ? { collectionId: selectedCollectionId } : {}),
            }
          : { jobId: publication?.job?.jobId };
      if (kind !== 'publisher.enqueue' && !payload.jobId) {
        throw new Error('publish_job_missing');
      }
      const result = await browser.runtime.sendMessage({ kind, payload });
      const failure = parsePublicationFailureResponse(result);
      if (failure) {
        setError(publicationFailureMessage(failure.errorCode, failure.requestId));
        return;
      }
      if (!result) {
        throw new Error('publisher_command_failed');
      }
      await refresh();
    } catch {
      setError('Atrium could not be updated. The durable draft remains safe to retry.');
    } finally {
      setPending(false);
    }
  };

  const authenticationCommand = async (kind: 'publisher.sign-in' | 'publisher.sign-out') => {
    setPending(true);
    setError(undefined);
    try {
      const result = await browser.runtime.sendMessage({ kind });
      if (!result) {
        throw new Error('authentication_command_failed');
      }
      if (
        kind === 'publisher.sign-in' &&
        typeof result === 'object' &&
        'errorCode' in result &&
        typeof result.errorCode === 'string'
      ) {
        setError(authenticationFailureMessage(result.errorCode));
        return;
      }
      await refresh();
    } catch {
      setError(
        kind === 'publisher.sign-in'
          ? 'Atrium sign-in could not be completed.'
          : 'Atrium sign-out could not be completed.',
      );
    } finally {
      setPending(false);
    }
  };

  const exportDiagnostics = async () => {
    setError(undefined);
    try {
      const next = (await browser.runtime.sendMessage({
        kind: 'diagnostics.snapshot',
      })) as SupportDiagnostics;
      const blob = new Blob([`${JSON.stringify(next, undefined, 2)}\n`], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.download = `atrium-capture-diagnostics-${next.generatedAt.slice(0, 10)}.json`;
      anchor.href = url;
      anchor.click();
      URL.revokeObjectURL(url);
      setDiagnostics(next);
    } catch {
      setError('Support diagnostics could not be prepared.');
    }
  };

  const clearLocalData = async () => {
    if (
      !window.confirm(
        'Delete every local Atrium Capture session, screenshot, edit receipt, and publishing job from this browser?',
      )
    ) {
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const result = await browser.runtime.sendMessage({
        kind: 'diagnostics.clear-local-data',
        payload: { confirmation: 'DELETE_LOCAL_CAPTURE_DATA' },
      });
      if (!result) {
        throw new Error('local_clear_failed');
      }
      setSession(undefined);
      setPublication(undefined);
      await Promise.all([refresh(), refreshDiagnostics()]);
    } catch {
      setError('Local capture data could not be deleted.');
    } finally {
      setPending(false);
    }
  };

  const state = session?.state;
  const isRecording = state === AtriumCaptureSessionState.Recording;
  const isPaused = state === AtriumCaptureSessionState.Paused;
  const isReview = state === AtriumCaptureSessionState.Review;
  const isPublishable = state === AtriumCaptureSessionState.Publishable;
  const isSubmitted = state === AtriumCaptureSessionState.Submitted;
  const canEditTitle = Boolean(session);
  const canStart = !session && diagnostics?.managedPolicy.valid !== false;
  const canCreateNew =
    Boolean(session && !isRecording && !isPaused) && diagnostics?.managedPolicy.valid !== false;
  const canCreateDraft = Boolean(
    publication?.capabilities.idempotentWrites &&
    publication.capabilities.immutableAssets &&
    (publication.authentication === 'not_required' || publication.authentication === 'signed_in'),
  );
  const nextAction = (() => {
    if (!session) {
      return 'Start a recording. When you stop, Atrium Capture will walk you through privacy review.';
    }
    if (isRecording || isPaused) {
      return 'Finish the recording to review the captured steps and remove private information.';
    }
    if (isReview) {
      return 'Review each step, add required redactions, and prepare the images for publishing.';
    }
    if (isPublishable && publication?.authentication === 'signed_out') {
      return 'Your reviewed images are ready. Sign in to AI Studio to create a private Atrium draft.';
    }
    if (isPublishable) {
      return 'Your reviewed images are ready to save as a private Atrium draft.';
    }
    if (isSubmitted) {
      return 'Your private Atrium draft is ready. Open it in Atrium or publish it internally when approved.';
    }
    return 'Start a new recording when you are ready.';
  })();

  const approveClearSteps = async () => {
    if (!session) {
      return;
    }
    await editorCommand({ kind: 'approve_clear_steps' });
  };

  const addSuggestedRedaction = async () => {
    if (!selectedStep || !selectedFlag?.geometry) {
      return;
    }
    await editorCommand({
      annotation: {
        color: '#111827',
        geometry: selectedFlag.geometry,
        id: crypto.randomUUID(),
        kind: Kind.Redaction,
      },
      kind: 'add_annotation',
      stepId: selectedStep.stepId,
    });
  };

  const imagePoint = (
    event: PointerEvent<HTMLDivElement>,
  ): { x: number; y: number } | undefined => {
    const image = imageRef.current;
    if (!image || !selectedAsset) {
      return undefined;
    }
    const bounds = image.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          selectedAsset.pixelWidth,
          ((event.clientX - bounds.left) / bounds.width) * selectedAsset.pixelWidth,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          selectedAsset.pixelHeight,
          ((event.clientY - bounds.top) / bounds.height) * selectedAsset.pixelHeight,
        ),
      ),
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!tool) {
      return;
    }
    const point = imagePoint(event);
    if (point) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrawingStart(point);
    }
  };

  const onPointerUp = async (event: PointerEvent<HTMLDivElement>) => {
    const end = imagePoint(event);
    if (!selectedStep || !drawingStart || !end || !tool) {
      setDrawingStart(undefined);
      return;
    }
    const geometry: Geometry = {
      height: Math.abs(end.y - drawingStart.y),
      width: Math.abs(end.x - drawingStart.x),
      x: Math.min(end.x, drawingStart.x),
      y: Math.min(end.y, drawingStart.y),
    };
    setDrawingStart(undefined);
    if (geometry.width < 2 || geometry.height < 2) {
      return;
    }
    if (tool === 'crop') {
      await editorCommand({ crop: geometry, kind: 'set_crop', stepId: selectedStep.stepId });
      return;
    }
    await editorCommand({
      annotation: {
        ...(tool === Kind.Arrow ? { arrowDirection: directionForArrow(drawingStart, end) } : {}),
        geometry,
        id: crypto.randomUUID(),
        kind: tool,
        ...(tool === Kind.Text ? { text: textDraft.trim() || 'Note' } : {}),
        ...(tool !== Kind.Blur && tool !== Kind.Mosaic ? { color: colorFor(tool) } : {}),
      },
      kind: 'add_annotation',
      stepId: selectedStep.stepId,
    });
  };

  const atriumDraftUrl = safeAtriumDraftUrl(
    publication?.job?.readerUrl,
    publication?.capabilities.mode,
  );

  return (
    <main>
      <header>
        <div className="brand-lockup">
          <span aria-hidden="true" className="brand-mark">
            A
          </span>
          <div>
            <p className="eyebrow">Atrium Capture</p>
            {session ? (
              <div className="title-editor">
                <input
                  aria-label="Guide title"
                  disabled={!canEditTitle}
                  maxLength={500}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  value={titleDraft}
                />
                {canEditTitle && (
                  <button
                    className="secondary"
                    disabled={pending || !titleDraft.trim() || titleDraft === session.title}
                    onClick={() => void editorCommand({ kind: 'update_title', title: titleDraft })}
                    type="button"
                  >
                    Save
                  </button>
                )}
              </div>
            ) : (
              <h1>New visual guide</h1>
            )}
            {session && publication?.job && (
              <p className="title-lock">
                {publication.job.remoteTitle === session.title
                  ? 'Title saved in Atrium.'
                  : publication.job.contentObjectId
                    ? 'Title saved locally; Atrium sync will retry automatically.'
                    : 'Title saved locally and will sync after Atrium confirms the draft.'}
              </p>
            )}
          </div>
        </div>
        <p className={`status ${isRecording ? 'recording' : ''}`} role="status">
          <span aria-hidden="true" className="status-dot" />
          {stateLabel(state)}
        </p>
        <p className="privacy-promise">Private by default · reviewed before publishing</p>
      </header>

      <section aria-label="Recording controls" className="controls">
        {guides.length > 1 && (
          <select
            aria-label="Saved guides"
            disabled={pending || isRecording || isPaused}
            onChange={(event) => void activateGuide(event.target.value)}
            value={session?.sessionId ?? ''}
          >
            {guides.map((guide) => (
              <option key={guide.sessionId} value={guide.sessionId}>
                {guide.title} · {stateLabel(guide.state)}
              </option>
            ))}
          </select>
        )}
        {canStart && (
          <button disabled={pending} onClick={() => void recorderCommand('start')} type="button">
            Start recording
          </button>
        )}
        {canCreateNew && (
          <button disabled={pending} onClick={() => void recorderCommand('new')} type="button">
            New guide
          </button>
        )}
        {isRecording && (
          <button disabled={pending} onClick={() => void recorderCommand('pause')} type="button">
            Pause
          </button>
        )}
        {isPaused && (
          <button disabled={pending} onClick={() => void recorderCommand('resume')} type="button">
            Resume
          </button>
        )}
        {(isRecording || isPaused) && (
          <button
            className="secondary"
            disabled={pending}
            onClick={() => void recorderCommand('stop')}
            type="button"
          >
            Stop and review
          </button>
        )}
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section aria-labelledby="next-action-heading" className="next-action">
        <h2 id="next-action-heading">Next step</h2>
        <p>{nextAction}</p>
      </section>

      {diagnostics?.managedPolicy.valid === false && (
        <section className="policy-error" role="alert">
          <strong>Recording disabled by invalid managed policy</strong>
          <p>Ask district support to validate the Atrium Capture policy configuration.</p>
        </section>
      )}

      <section aria-labelledby="steps-heading" className="steps">
        <div className="section-heading">
          <h2 id="steps-heading">Steps</h2>
          <span>{session?.steps.length ?? 0}</span>
        </div>
        {session?.steps.length ? (
          <ol>
            {session.steps.map((step) => (
              <li className={step.stepId === selectedStepId ? 'selected' : ''} key={step.stepId}>
                <button
                  className="step-select"
                  onClick={() => setSelectedStepId(step.stepId)}
                  type="button"
                >
                  <span className="sequence">{step.sequence + 1}</span>
                  <span>
                    <strong>{step.instruction.editedText ?? step.instruction.generatedText}</strong>
                    <small>
                      {step.action} · {privacyLabel(step, issues)}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty">Meaningful actions will appear here after recording starts.</p>
        )}
      </section>

      {isReview && selectedStep && (
        <section aria-labelledby="review-heading" className="review">
          <div className="section-heading">
            <h2 id="review-heading">Review step {selectedIndex + 1}</h2>
            <span>{issues.length} checks left</span>
          </div>

          <div className="step-actions">
            <button
              disabled={pending || selectedIndex <= 0}
              onClick={() =>
                void editorCommand({
                  kind: 'move_step',
                  stepId: selectedStep.stepId,
                  toIndex: selectedIndex - 1,
                })
              }
              type="button"
            >
              Move up
            </button>
            <button
              disabled={pending || !session || selectedIndex >= session.steps.length - 1}
              onClick={() =>
                void editorCommand({
                  kind: 'move_step',
                  stepId: selectedStep.stepId,
                  toIndex: selectedIndex + 1,
                })
              }
              type="button"
            >
              Move down
            </button>
            <button
              disabled={pending || selectedIndex <= 0 || !session}
              onClick={() =>
                void editorCommand({
                  kind: 'merge_step',
                  stepId: session!.steps[selectedIndex - 1]!.stepId,
                  withStepId: selectedStep.stepId,
                })
              }
              type="button"
            >
              Merge previous
            </button>
            <button
              className="danger"
              disabled={pending}
              onClick={() =>
                void editorCommand({ kind: 'delete_step', stepId: selectedStep.stepId })
              }
              type="button"
            >
              Delete
            </button>
          </div>

          <label className="field-label" htmlFor="instruction-draft">
            Instruction
          </label>
          <textarea
            id="instruction-draft"
            maxLength={2000}
            onChange={(event) => setInstructionDraft(event.target.value)}
            value={instructionDraft}
          />
          <button
            disabled={pending || !instructionDraft.trim()}
            onClick={() =>
              void editorCommand({
                kind: 'update_instruction',
                stepId: selectedStep.stepId,
                text: instructionDraft,
              })
            }
            type="button"
          >
            Save instruction
          </button>

          <div className="insert-row">
            <input
              aria-label="New manual step"
              maxLength={2000}
              onChange={(event) => setManualDraft(event.target.value)}
              placeholder="Add a manual step"
              value={manualDraft}
            />
            <button
              disabled={pending || !manualDraft.trim()}
              onClick={() =>
                void editorCommand({
                  afterStepId: selectedStep.stepId,
                  kind: 'insert_step',
                  text: manualDraft,
                }).then((next) => next && setManualDraft(''))
              }
              type="button"
            >
              Insert
            </button>
          </div>

          {assetDataUrl && selectedAsset ? (
            <>
              <div className="toolbar" role="toolbar" aria-label="Screenshot tools">
                <button
                  aria-pressed={tool === 'crop'}
                  onClick={() => setTool('crop')}
                  type="button"
                >
                  Crop
                </button>
                {annotationTools.map((item) => (
                  <button
                    aria-pressed={tool === item.kind}
                    key={item.kind}
                    onClick={() => setTool(item.kind)}
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {tool === Kind.Text && (
                <input
                  aria-label="Annotation text"
                  maxLength={1000}
                  onChange={(event) => setTextDraft(event.target.value)}
                  value={textDraft}
                />
              )}
              <label className="zoom-control">
                Zoom
                <input
                  aria-label="Screenshot zoom"
                  max="2"
                  min="0.5"
                  onChange={(event) => setZoom(Number(event.target.value))}
                  step="0.1"
                  type="range"
                  value={zoom}
                />
                {Math.round(zoom * 100)}%
              </label>
              <div className="image-scroll">
                <div
                  className="image-stage"
                  onPointerDown={onPointerDown}
                  onPointerUp={(event) => void onPointerUp(event)}
                  style={{ width: `${zoom * 100}%` }}
                >
                  <img
                    alt={`Screenshot for step ${selectedIndex + 1}`}
                    draggable={false}
                    ref={imageRef}
                    src={assetDataUrl}
                  />
                  <svg
                    aria-hidden="true"
                    preserveAspectRatio="none"
                    viewBox={`0 0 ${selectedAsset.pixelWidth} ${selectedAsset.pixelHeight}`}
                  >
                    {selectedStep.annotations?.map(renderAnnotationPreview)}
                    {selectedStep.crop && <rect className="crop-preview" {...selectedStep.crop} />}
                    {selectedFlag?.geometry && selectedSensitiveIssue && (
                      <rect className="flag-preview" {...selectedFlag.geometry} />
                    )}
                  </svg>
                </div>
              </div>
              <p className="hint">
                Choose a tool, then drag over the screenshot. Mosaic and blur are visual
                annotations; only Redact satisfies a sensitive-region check.
              </p>
              {selectedStep.annotations?.length ? (
                <ul className="annotations">
                  {selectedStep.annotations.map((annotation) => (
                    <li key={annotation.id}>
                      <span>{annotation.kind}</span>
                      <button
                        onClick={() =>
                          void editorCommand({
                            annotationId: annotation.id,
                            kind: 'remove_annotation',
                            stepId: selectedStep.stepId,
                          })
                        }
                        type="button"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="empty">This step has no local screenshot to edit.</p>
          )}

          {selectedSensitiveIssue && selectedFlag?.geometry && (
            <div className="privacy-callout">
              <strong>Sensitive region flagged</strong>
              <p>
                An input field may contain private information. Confirm an opaque redaction before
                approval.
              </p>
              <button disabled={pending} onClick={() => void addSuggestedRedaction()} type="button">
                Add suggested redaction
              </button>
            </div>
          )}

          <div className="review-actions">
            <button
              disabled={
                pending ||
                selectedSensitiveIssue ||
                selectedStep.privacyReview === PrivacyReview.Approved
              }
              onClick={() =>
                void editorCommand({ kind: 'approve_step', stepId: selectedStep.stepId })
              }
              type="button"
            >
              Approve this step
            </button>
            <button
              className="secondary"
              disabled={pending}
              onClick={() => void approveClearSteps()}
              type="button"
            >
              Approve all clear steps
            </button>
          </div>

          <div className="finalize-row">
            <button
              disabled={pending || issues.length > 0}
              onClick={() => void finalize()}
              type="button"
            >
              Prepare publishable images
            </button>
            <small>
              {issues.length
                ? 'Resolve every privacy check first.'
                : diagnostics?.managedPolicy.rawImageRetention === 'delete_after_submit'
                  ? 'Raw originals remain local until the draft succeeds; they never enter the outbox.'
                  : 'Raw originals will be deleted after flattening.'}
            </small>
          </div>
        </section>
      )}

      {(isPublishable || isSubmitted) && (
        <section aria-labelledby="publish-heading" className="success-callout">
          <h2 id="publish-heading">Atrium draft</h2>
          <strong>Publishable images prepared</strong>
          <p>
            Annotations are flattened and metadata is stripped.{' '}
            {diagnostics?.managedPolicy.rawImageRetention === 'delete_after_submit' && !isSubmitted
              ? 'Raw source bytes remain local until the Atrium draft succeeds and are excluded from upload.'
              : 'Raw source bytes were deleted.'}
          </p>

          {isPublishable && !publication?.job && (
            <div className="insert-row">
              <input
                aria-label="New manual step"
                maxLength={2000}
                onChange={(event) => setManualDraft(event.target.value)}
                placeholder="Add a manual step"
                value={manualDraft}
              />
              <button
                disabled={pending || !manualDraft.trim()}
                onClick={() =>
                  void editorCommand({
                    ...(session?.steps.at(-1)?.stepId
                      ? { afterStepId: session.steps.at(-1)!.stepId }
                      : {}),
                    kind: 'insert_step',
                    text: manualDraft,
                  }).then((next) => next && setManualDraft(''))
                }
                type="button"
              >
                Add
              </button>
              <small>Adding a step reopens privacy review before publishing.</small>
            </div>
          )}

          {publication?.authentication === 'unconfigured' && !publication.job && (
            <div className="capability-callout">
              <strong>AI Studio sign-in is temporarily unavailable</strong>
              <p>
                Contact district support. Your recording and privacy review remain available, and no
                capture data was sent.
              </p>
            </div>
          )}

          {publication?.authentication === 'signed_out' && (
            <div className="capability-callout">
              <strong>Sign in to AI Studio</strong>
              <p>
                Use your district account. You will return here automatically; tokens stay in the
                trusted extension context and are never shared with recorded pages.
              </p>
              <button
                disabled={pending}
                onClick={() => void authenticationCommand('publisher.sign-in')}
                type="button"
              >
                Sign in to AI Studio
              </button>
            </div>
          )}

          {canCreateDraft && !publication?.job && (
            <div className="publish-controls">
              {publication?.authentication === 'signed_in' && (
                <div className="publish-authentication">
                  <small>Connected to Atrium</small>
                  <button
                    className="secondary"
                    disabled={pending}
                    onClick={() => void authenticationCommand('publisher.sign-out')}
                    type="button"
                  >
                    Sign out
                  </button>
                </div>
              )}
              {publication && publication.collections.length > 0 ? (
                <>
                  <label htmlFor="collection-picker">Collection</label>
                  <select
                    id="collection-picker"
                    onChange={(event) => setSelectedCollectionId(event.target.value)}
                    value={selectedCollectionId}
                  >
                    {publication.collections.map((collection) => (
                      <option key={collection.collectionId} value={collection.collectionId}>
                        {collection.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <small>
                  No selectable collection is required; the private draft will be unfiled.
                </small>
              )}
              {publication?.collectionSource === 'managed_default' && (
                <small>Set by district managed policy.</small>
              )}
              <button
                disabled={pending}
                onClick={() => void publisherCommand('publisher.enqueue')}
                type="button"
              >
                Save private Atrium draft
              </button>
            </div>
          )}

          {publication?.job && (
            <div className="publish-status" role="status">
              {publication.authentication === 'signed_in' && (
                <button
                  className="secondary"
                  disabled={pending}
                  onClick={() => void authenticationCommand('publisher.sign-out')}
                  type="button"
                >
                  Sign out of Atrium
                </button>
              )}
              <p>
                <strong>{publishPhaseLabel(publication.job.phase)}</strong>
              </p>
              {publication.job.lastError && (
                <p className="error">
                  {publication.job.lastError.code === 'title_update_failed'
                    ? publication.job.lastError.retryable
                      ? 'The new title is saved locally. Retry to update the Atrium title.'
                      : 'The new title is saved locally, but Atrium rejected the title update.'
                    : publication.job.lastError.retryable
                      ? 'The last request was interrupted and can be retried safely.'
                      : 'Publishing needs attention before it can continue.'}
                </p>
              )}
              {(publication.job.lastError || publication.job.phase === Phase.NeedsAttention) &&
                publication.authentication === 'signed_in' && (
                  <button
                    disabled={pending}
                    onClick={() => void publisherCommand('publisher.retry')}
                    type="button"
                  >
                    {publication.job.lastError?.retryable ? 'Retry safely' : 'Try again'}
                  </button>
                )}
              {atriumDraftUrl && (
                <a href={atriumDraftUrl} rel="noreferrer" target="_blank">
                  Open Atrium draft
                </a>
              )}
              {publication.job.phase === Phase.ReadyAsDraft &&
                publication.capabilities.internalPublication && (
                  <button
                    className="secondary"
                    disabled={pending}
                    onClick={() => void publisherCommand('publisher.publish-internal')}
                    type="button"
                  >
                    Publish internally
                  </button>
                )}
            </div>
          )}
        </section>
      )}

      <section className="support">
        <details>
          <summary>Support diagnostics</summary>
          <p>
            Diagnostics contain operational counts and policy status only—never screenshots,
            instructions, page URLs, typed values, or tokens.
          </p>
          {diagnostics && (
            <dl>
              <div>
                <dt>Version</dt>
                <dd>{diagnostics.application.version}</dd>
              </div>
              <div>
                <dt>Policy</dt>
                <dd>{diagnostics.managedPolicy.valid ? 'valid' : 'invalid'}</dd>
              </div>
              <div>
                <dt>Local image storage</dt>
                <dd>{formatBytes(diagnostics.storage.assetBytes)}</dd>
              </div>
              <div>
                <dt>Telemetry</dt>
                <dd>off</dd>
              </div>
            </dl>
          )}
          <button onClick={() => void exportDiagnostics()} type="button">
            Export safe diagnostics
          </button>
          <button
            className="danger"
            disabled={pending}
            onClick={() => void clearLocalData()}
            type="button"
          >
            Delete all local capture data
          </button>
        </details>
        <details>
          <summary>Why these permissions?</summary>
          <p>
            Site access observes bounded action metadata only during a recording. Visible-tab
            capture creates local screenshots. Storage preserves acknowledged steps across worker
            restarts. Identity is reserved for an interactive Atrium sign-in when the live service
            is configured.
          </p>
          <p>
            Mac enrichment is optional. If enabled, Chrome shows its native-app permission and the
            trusted worker sends semantic action metadata only—never screenshots, typed values, or
            tokens—to the installed Atrium Capture host.
          </p>
          <dl>
            <div>
              <dt>Mac enrichment</dt>
              <dd>{nativeBridge?.statusCode ?? 'DISABLED'}</dd>
            </div>
          </dl>
          <button onClick={() => void toggleNativeBridge()} type="button">
            {nativeBridge?.enabled ? 'Disable Mac enrichment' : 'Enable Mac enrichment'}
          </button>
        </details>
      </section>

      <footer>Typed values are omitted. Password fields are never captured.</footer>
    </main>
  );
}

function stateLabel(state?: AtriumCaptureSessionState): string {
  switch (state) {
    case AtriumCaptureSessionState.Recording:
      return 'Recording';
    case AtriumCaptureSessionState.Paused:
      return 'Paused';
    case AtriumCaptureSessionState.Review:
      return 'Ready for review';
    case AtriumCaptureSessionState.Publishable:
      return 'Privacy approved';
    case AtriumCaptureSessionState.Submitted:
      return 'Saved to Atrium';
    default:
      return 'Not recording';
  }
}

function publishPhaseLabel(phase: Phase): string {
  switch (phase) {
    case Phase.Queued:
    case Phase.CreatingObject:
      return 'Creating private draft…';
    case Phase.UploadingAssets:
      return 'Uploading publishable images…';
    case Phase.CreatingVersion:
      return 'Creating guide version…';
    case Phase.ReadyAsDraft:
      return 'Private draft ready';
    case Phase.PublishingInternal:
      return 'Publishing internally…';
    case Phase.Complete:
      return 'Published internally';
    case Phase.NeedsAttention:
      return 'Publishing needs attention';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeAtriumDraftUrl(
  value: string | undefined,
  mode: PublicationSnapshot['capabilities']['mode'] | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash || url.search) {
      return undefined;
    }
    if (
      mode === 'live' &&
      url.origin === 'https://aistudio.psd401.ai' &&
      /^\/atrium\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/edit$/i.test(
        url.pathname,
      )
    ) {
      return url.toString();
    }
    if (
      mode === 'mock' &&
      ((url.protocol === 'https:' && url.hostname.endsWith('.example.test')) ||
        (url.protocol === 'http:' &&
          (url.hostname === '127.0.0.1' || url.hostname === 'localhost')))
    ) {
      return url.toString();
    }
  } catch {
    // A malformed persisted or gateway URL is not exposed as a navigation.
  }
  return undefined;
}

function privacyLabel(step: StepElement, issues: ReviewIssue[]): string {
  if (
    issues.some(
      (issue) => issue.stepId === step.stepId && issue.code === 'sensitive_region_unredacted',
    )
  ) {
    return 'redaction required';
  }
  return step.privacyReview === PrivacyReview.Approved ? 'approved' : 'review required';
}

function colorFor(kind: Kind): string {
  if (kind === Kind.Redaction) {
    return '#111827';
  }
  if (kind === Kind.Highlight) {
    return '#FACC15';
  }
  return '#DC2626';
}

function renderAnnotationPreview(annotation: AnnotationElement) {
  const geometry = annotation.geometry;
  if (annotation.kind === Kind.Arrow) {
    const { endX, endY, startX, startY } = arrowEndpoints(geometry, annotation.arrowDirection);
    const angle = Math.atan2(endY - startY, endX - startX);
    const head = Math.max(8, Math.min(20, Math.min(geometry.width, geometry.height) / 2));
    const headOne = `${endX - head * Math.cos(angle - Math.PI / 6)},${
      endY - head * Math.sin(angle - Math.PI / 6)
    }`;
    const headTwo = `${endX - head * Math.cos(angle + Math.PI / 6)},${
      endY - head * Math.sin(angle + Math.PI / 6)
    }`;
    return (
      <g key={annotation.id}>
        <line
          className="annotation-arrow"
          stroke={annotation.color ?? '#DC2626'}
          strokeWidth="4"
          x1={startX}
          x2={endX}
          y1={startY}
          y2={endY}
        />
        <polyline
          fill="none"
          points={`${headOne} ${endX},${endY} ${headTwo}`}
          stroke={annotation.color ?? '#DC2626'}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />
      </g>
    );
  }
  if (annotation.kind === Kind.Text) {
    return (
      <text
        fill={annotation.color ?? '#DC2626'}
        fontSize={Math.max(14, geometry.height)}
        key={annotation.id}
        x={geometry.x}
        y={geometry.y + Math.max(14, geometry.height)}
      >
        {annotation.text}
      </text>
    );
  }
  return (
    <rect
      className={`annotation-preview ${annotation.kind}`}
      fill={
        annotation.kind === Kind.Rectangle
          ? 'none'
          : (annotation.color ?? colorFor(annotation.kind))
      }
      height={geometry.height}
      key={annotation.id}
      stroke={annotation.kind === Kind.Rectangle ? (annotation.color ?? '#DC2626') : 'none'}
      strokeWidth="4"
      width={geometry.width}
      x={geometry.x}
      y={geometry.y}
    />
  );
}
