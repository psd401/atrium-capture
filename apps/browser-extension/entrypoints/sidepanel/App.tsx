import {
  AssetState,
  AtriumCaptureSessionState,
  Kind,
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedStepId, setSelectedStepId] = useState<string>();
  const [assetDataUrl, setAssetDataUrl] = useState<string>();
  const [tool, setTool] = useState<DrawingTool>();
  const [zoom, setZoom] = useState(1);
  const [instructionDraft, setInstructionDraft] = useState('');
  const [manualDraft, setManualDraft] = useState('');
  const [textDraft, setTextDraft] = useState('Note');
  const [drawingStart, setDrawingStart] = useState<{ x: number; y: number }>();
  const imageRef = useRef<HTMLImageElement>(null);

  const refresh = useCallback(async () => {
    const next = (await browser.runtime.sendMessage({ kind: 'recorder.snapshot' })) as
      AtriumCaptureSession | undefined;
    setSession(next);
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 500);
    return () => window.clearInterval(interval);
  }, [refresh]);

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

  const recorderCommand = async (command: 'start' | 'pause' | 'resume' | 'stop') => {
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
        payload: { commandId: crypto.randomUUID(), rawRetention: 'delete_after_flatten' },
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

  const state = session?.state;
  const isRecording = state === AtriumCaptureSessionState.Recording;
  const isPaused = state === AtriumCaptureSessionState.Paused;
  const isReview = state === AtriumCaptureSessionState.Review;
  const isPublishable = state === AtriumCaptureSessionState.Publishable;
  const canStart = !session || (!isRecording && !isPaused && !isReview && !isPublishable);

  const approveClearSteps = async () => {
    if (!session) {
      return;
    }
    let latest: AtriumCaptureSession | undefined;
    for (const step of session.steps) {
      const blocked = issues.some(
        (issue) => issue.stepId === step.stepId && issue.code === 'sensitive_region_unredacted',
      );
      if (!blocked && step.privacyReview !== PrivacyReview.Approved) {
        latest = await editorCommand({ kind: 'approve_step', stepId: step.stepId });
        if (!latest) {
          return;
        }
      }
    }
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

  return (
    <main>
      <header>
        <p className="eyebrow">Atrium Capture</p>
        <h1>{session?.title ?? 'New visual guide'}</h1>
        <p className={`status ${isRecording ? 'recording' : ''}`} role="status">
          <span aria-hidden="true" className="status-dot" />
          {stateLabel(state)}
        </p>
      </header>

      <section aria-label="Recording controls" className="controls">
        {canStart && (
          <button disabled={pending} onClick={() => void recorderCommand('start')} type="button">
            Start recording
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

      {error && <p className="error">{error}</p>}

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
                : 'Raw originals will be deleted after flattening.'}
            </small>
          </div>
        </section>
      )}

      {isPublishable && (
        <section className="success-callout">
          <strong>Publishable images prepared</strong>
          <p>Annotations are flattened, metadata is stripped, and raw source bytes were deleted.</p>
        </section>
      )}

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
    default:
      return 'Not recording';
  }
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
    return (
      <line
        className="annotation-arrow"
        key={annotation.id}
        stroke={annotation.color ?? '#DC2626'}
        strokeWidth="4"
        x1={geometry.x}
        x2={geometry.x + geometry.width}
        y1={geometry.y + geometry.height}
        y2={geometry.y}
      />
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
