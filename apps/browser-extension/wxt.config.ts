import { readFileSync } from 'node:fs';

import { defineConfig } from 'wxt';

interface BrowserIdentity {
  extensionId: string;
  publicKey: string;
}

const browserIdentity = JSON.parse(
  readFileSync(new URL('../../config/browser-identity.json', import.meta.url), 'utf8'),
) as BrowserIdentity;

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: () => {
    const chromeWebStoreUpload = process.env.ATRIUM_CAPTURE_STORE_UPLOAD === '1';

    return {
      action: {
        default_icon: {
          16: 'icons/16.png',
          32: 'icons/32.png',
        },
        default_title: 'Open Atrium Capture',
      },
      description: 'Record and review visual workflows before saving a private Atrium draft.',
      host_permissions: ['<all_urls>'],
      icons: {
        16: 'icons/16.png',
        32: 'icons/32.png',
        48: 'icons/48.png',
        128: 'icons/128.png',
      },
      // Chrome Web Store rejects `key` in uploaded manifests and injects the
      // authoritative key itself. Development and test builds retain that
      // public key so unpacked profiles use the same extension origin.
      ...(chromeWebStoreUpload ? {} : { key: browserIdentity.publicKey }),
      minimum_chrome_version: '116',
      name: 'Atrium Capture',
      optional_permissions: ['nativeMessaging'],
      permissions: ['identity', 'sidePanel', 'storage', 'unlimitedStorage'],
      storage: {
        managed_schema: 'managed-storage-schema.json',
      },
    };
  },
});
