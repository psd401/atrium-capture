import type { CaptureEventMessage } from './messages.js';

const hostName = 'org.psd401.atrium_capture';
const enabledKey = 'nativeBridgeEnabled';
const maximumMessageBytes = 64 * 1024;

export interface NativeBridgeAdapter {
  hasPermission(): Promise<boolean>;
  loadEnabled(): Promise<boolean>;
  saveEnabled(enabled: boolean): Promise<void>;
  send(message: object): Promise<unknown>;
}

export interface NativeBridgeSnapshot {
  enabled: boolean;
  hostName: string;
  permissionGranted: boolean;
  statusCode: 'DISABLED' | 'READY' | 'HOST_UNAVAILABLE' | 'PERMISSION_REQUIRED';
}

export class NativeBridgeService {
  private statusCode: NativeBridgeSnapshot['statusCode'] = 'DISABLED';

  public constructor(private readonly adapter: NativeBridgeAdapter) {}

  public async snapshot(): Promise<NativeBridgeSnapshot> {
    const [enabled, permissionGranted] = await Promise.all([
      this.adapter.loadEnabled(),
      this.adapter.hasPermission(),
    ]);
    const statusCode = !enabled
      ? 'DISABLED'
      : !permissionGranted
        ? 'PERMISSION_REQUIRED'
        : this.statusCode === 'HOST_UNAVAILABLE'
          ? 'HOST_UNAVAILABLE'
          : 'READY';
    return { enabled, hostName, permissionGranted, statusCode };
  }

  public async setEnabled(enabled: boolean): Promise<NativeBridgeSnapshot> {
    if (enabled && !(await this.adapter.hasPermission())) {
      this.statusCode = 'PERMISSION_REQUIRED';
      await this.adapter.saveEnabled(false);
      return this.snapshot();
    }
    await this.adapter.saveEnabled(enabled);
    this.statusCode = enabled ? 'READY' : 'DISABLED';
    if (enabled) {
      await this.sendEnvelope('hello', { surface: 'browser', capability: 'semantic_metadata' });
    }
    return this.snapshot();
  }

  public async forwardCaptureEvent(message: CaptureEventMessage): Promise<void> {
    const snapshot = await this.snapshot();
    if (!snapshot.enabled || !snapshot.permissionGranted) return;
    await this.sendEnvelope('dom_step', {
      action: message.payload.action,
      eventId: message.payload.eventId,
      occurredAt: message.payload.occurredAt,
      target: message.payload.target
        ? {
            accessibleName: message.payload.target.accessibleName,
            role: message.payload.target.role,
          }
        : undefined,
    });
  }

  private async sendEnvelope(type: 'dom_step' | 'hello', payload: object): Promise<void> {
    const messageId = crypto.randomUUID();
    const envelope = {
      protocolVersion: 1,
      messageId,
      type,
      sentAt: new Date().toISOString(),
      payload,
    };
    if (!isMetadataOnly(envelope) || serializedByteLength(envelope) > maximumMessageBytes) {
      this.statusCode = 'HOST_UNAVAILABLE';
      return;
    }
    try {
      const response = await this.adapter.send(envelope);
      this.statusCode = isValidResponse(response, messageId) ? 'READY' : 'HOST_UNAVAILABLE';
    } catch {
      this.statusCode = 'HOST_UNAVAILABLE';
    }
  }
}

export function createBrowserNativeBridgeAdapter(browserApi: typeof import('wxt/browser').browser) {
  return {
    hasPermission: () => browserApi.permissions.contains({ permissions: ['nativeMessaging'] }),
    loadEnabled: async () => {
      const value = await browserApi.storage.local.get(enabledKey);
      return value[enabledKey] === true;
    },
    saveEnabled: async (enabled: boolean) =>
      browserApi.storage.local.set({ [enabledKey]: enabled }),
    send: (message: object) => browserApi.runtime.sendNativeMessage(hostName, message),
  } satisfies NativeBridgeAdapter;
}

function isValidResponse(value: unknown, correlationId: string): boolean {
  if (!isMetadataOnly(value) || !isRecord(value)) return false;
  if (serializedByteLength(value) > maximumMessageBytes) return false;
  const keys = Object.keys(value);
  if (
    keys.some(
      (key) =>
        !['protocolVersion', 'messageId', 'type', 'sentAt', 'correlationId', 'payload'].includes(
          key,
        ),
    )
  ) {
    return false;
  }
  return (
    value.protocolVersion === 1 &&
    isUuid(value.messageId) &&
    isDateTime(value.sentAt) &&
    ['hello_ack', 'session_state', 'error'].includes(String(value.type)) &&
    value.correlationId === correlationId &&
    isRecord(value.payload) &&
    Object.keys(value.payload).length === 1 &&
    typeof value.payload.code === 'string' &&
    /^[A-Z0-9_]{1,64}$/.test(value.payload.code)
  );
}

function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function isDateTime(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

function isMetadataOnly(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(isMetadataOnly);
  if (isRecord(value)) {
    return Object.entries(value).every(([key, nested]) => {
      const normalized = key.toLowerCase().replaceAll('_', '');
      if (
        [
          'authorization',
          'accesstoken',
          'refreshtoken',
          'bearertoken',
          'screenshotbytes',
          'imagedata',
          'imagebytes',
          'pixelbytes',
          'base64',
          'value',
          'fieldvalue',
          'typedvalue',
          'password',
        ].includes(normalized)
      ) {
        return false;
      }
      return isMetadataOnly(nested);
    });
  }
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    return !normalized.includes('data:image/') && !normalized.startsWith('bearer ');
  }
  return (
    value === undefined || value === null || typeof value === 'number' || typeof value === 'boolean'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
