import { AtriumCaptureSessionState, type AtriumCaptureSession } from '@atrium-capture/contracts';
import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

export function App() {
  const [session, setSession] = useState<AtriumCaptureSession>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

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

  const command = async (nextCommand: 'start' | 'pause' | 'resume' | 'stop') => {
    setPending(true);
    setError(undefined);
    try {
      const next = (await browser.runtime.sendMessage({
        kind: 'recorder.command',
        payload: { command: nextCommand, commandId: crypto.randomUUID() },
      })) as AtriumCaptureSession | undefined;
      setSession(next);
    } catch {
      setError('The recorder could not update. Try again.');
    } finally {
      setPending(false);
    }
  };

  const state = session?.state;
  const isRecording = state === AtriumCaptureSessionState.Recording;
  const isPaused = state === AtriumCaptureSessionState.Paused;
  const canStart = !session || (!isRecording && !isPaused);

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
          <button disabled={pending} onClick={() => void command('start')} type="button">
            Start recording
          </button>
        )}
        {isRecording && (
          <button disabled={pending} onClick={() => void command('pause')} type="button">
            Pause
          </button>
        )}
        {isPaused && (
          <button disabled={pending} onClick={() => void command('resume')} type="button">
            Resume
          </button>
        )}
        {(isRecording || isPaused) && (
          <button
            className="secondary"
            disabled={pending}
            onClick={() => void command('stop')}
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
              <li key={step.stepId}>
                <span className="sequence">{step.sequence + 1}</span>
                <div>
                  <p>{step.instruction.editedText ?? step.instruction.generatedText}</p>
                  <small>{step.action}</small>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty">Meaningful actions will appear here after recording starts.</p>
        )}
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
    default:
      return 'Not recording';
  }
}
