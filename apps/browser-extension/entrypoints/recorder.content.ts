import { Action } from '@atrium-capture/contracts';
import {
  classifyField,
  type FieldDescriptor,
  type SourceUrlRetention,
} from '@atrium-capture/privacy';
import { browser } from 'wxt/browser';

import type { CaptureEventMessage } from '../src/messages.js';

interface ContentState {
  active: boolean;
  sourceUrlRetention: SourceUrlRetention;
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  main(ctx) {
    let active = false;
    let retention: SourceUrlRetention = 'origin';
    let listenersAttached = false;

    const sendWithRetry = async (message: CaptureEventMessage): Promise<void> => {
      for (const delay of [0, 100, 400]) {
        if (delay > 0) {
          await new Promise<void>((resolve) => ctx.setTimeout(resolve, delay));
        }
        try {
          await browser.runtime.sendMessage(message);
          return;
        } catch {
          if (!ctx.isValid) {
            return;
          }
        }
      }
    };

    const emit = (action: Action, element?: Element, shortcut?: string): void => {
      if (!active || (element && isSensitiveElement(element))) {
        return;
      }

      const message: CaptureEventMessage = {
        kind: 'capture.event',
        payload: {
          action,
          eventId: crypto.randomUUID(),
          occurredAt: new Date().toISOString(),
          ...(shortcut ? { shortcut } : {}),
          target: describeTarget(element),
        },
      };
      void sendWithRetry(message);
    };

    const onClick = (event: Event): void => {
      if (event.target instanceof Element) {
        emit(Action.Click, event.target);
      }
    };

    const onChange = (event: Event): void => {
      if (!(event.target instanceof Element) || isSensitiveElement(event.target)) {
        return;
      }
      emit(event.target instanceof HTMLSelectElement ? Action.Select : Action.Input, event.target);
    };

    const onSubmit = (event: Event): void => {
      if (event.target instanceof HTMLFormElement) {
        emit(Action.Submit, event.target);
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.altKey || event.ctrlKey || event.metaKey) || isSensitiveElement(event.target)) {
        return;
      }

      const modifiers = [
        event.ctrlKey ? 'Ctrl' : undefined,
        event.altKey ? 'Alt' : undefined,
        event.shiftKey ? 'Shift' : undefined,
        event.metaKey ? 'Meta' : undefined,
      ].filter((part): part is string => Boolean(part));
      const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
      emit(
        Action.Shortcut,
        event.target instanceof Element ? event.target : undefined,
        [...modifiers, key].join('+'),
      );
    };

    const attachListeners = (): void => {
      if (listenersAttached) {
        return;
      }
      document.addEventListener('click', onClick, true);
      document.addEventListener('change', onChange, true);
      document.addEventListener('submit', onSubmit, true);
      document.addEventListener('keydown', onKeyDown, true);
      listenersAttached = true;
      emit(Action.Navigate, document.documentElement);
    };

    const detachListeners = (): void => {
      if (!listenersAttached) {
        return;
      }
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('submit', onSubmit, true);
      document.removeEventListener('keydown', onKeyDown, true);
      listenersAttached = false;
    };

    const refreshState = async (): Promise<void> => {
      try {
        const state = (await browser.runtime.sendMessage({
          kind: 'recorder.content-state',
          payload: { url: location.href },
        })) as ContentState;
        active = state.active;
        retention = state.sourceUrlRetention;
        if (active) {
          attachListeners();
        } else {
          detachListeners();
        }
      } catch {
        active = false;
        detachListeners();
      }
    };

    browser.runtime.onMessage.addListener((message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'kind' in message &&
        message.kind === 'recorder.refresh'
      ) {
        void refreshState();
      }
    });

    ctx.onInvalidated(detachListeners);
    void refreshState();

    function describeTarget(
      element?: Element,
    ): NonNullable<CaptureEventMessage['payload']['target']> {
      const target: NonNullable<CaptureEventMessage['payload']['target']> = {
        browser: {
          devicePixelRatio: window.devicePixelRatio || 1,
          origin: location.origin,
          pageTitle: document.title.slice(0, 500),
          viewportCss: { height: window.innerHeight, width: window.innerWidth },
          ...(retention === 'full' ? { path: location.pathname } : {}),
        },
      };

      if (!element) {
        return target;
      }

      const accessibleName = getAccessibleName(element);
      const role = getRole(element);
      const bounds = element.getBoundingClientRect();
      if (accessibleName) {
        target.accessibleName = accessibleName;
      }
      if (role) {
        target.role = role;
      }
      if (bounds.width > 0 && bounds.height > 0) {
        target.bounds = {
          height: bounds.height,
          width: bounds.width,
          x: bounds.x,
          y: bounds.y,
        };
      }
      if (element.id) {
        target.browser!.selectors = [`#${CSS.escape(element.id)}`];
      }
      return target;
    }
  },
});

function isSensitiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const field = target.closest('input, textarea, select, [contenteditable="true"]');
  if (!field) {
    return false;
  }

  const descriptor: FieldDescriptor = {
    tagName: field.tagName.toLowerCase(),
    ...(field.getAttribute('autocomplete')
      ? { autocomplete: field.getAttribute('autocomplete') as string }
      : {}),
    ...(field.getAttribute('inputmode')
      ? { inputMode: field.getAttribute('inputmode') as string }
      : {}),
    ...(field.getAttribute('role') ? { role: field.getAttribute('role') as string } : {}),
    ...(field instanceof HTMLInputElement ? { type: field.type } : {}),
  };
  return classifyField(descriptor).capture === 'deny';
}

function getAccessibleName(element: Element): string | undefined {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    return cleanText(ariaLabel);
  }

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (text.trim()) {
      return cleanText(text);
    }
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const labels = Array.from(element.labels ?? [])
      .map((label) => label.textContent ?? '')
      .join(' ');
    if (labels.trim()) {
      return cleanText(labels);
    }
  }

  return cleanText(element.textContent ?? '');
}

function cleanText(text: string): string | undefined {
  const cleaned = text.replace(/\s+/g, ' ').trim().slice(0, 500);
  return cleaned || undefined;
}

function getRole(element: Element): string | undefined {
  const explicit = element.getAttribute('role');
  if (explicit) {
    return explicit.slice(0, 100);
  }

  const roles: Partial<Record<string, string>> = {
    A: 'link',
    BUTTON: 'button',
    FORM: 'form',
    INPUT: 'textbox',
    SELECT: 'combobox',
    TEXTAREA: 'textbox',
  };
  return roles[element.tagName];
}
