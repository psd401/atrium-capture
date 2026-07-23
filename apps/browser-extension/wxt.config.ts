import { defineConfig } from 'wxt';

const manifestPublicKey =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlTvrb5kWrnpWNisHiDz2FXYjwWQBbLgkJXHaMs2p4zv6OQwk3YeFX48spx/Wg1PgyXGVbqGi8xIGTq53/XbfLBLgsp5uIbC26YuIVEob5DpBXagBRikQ0igDN6NTKyQ20Sz6ynvM+u7Uw+pJnLm/crnvkjotxvAcArLC/3RJQVGcY3HqUSWTRTDbCumbSwfmiQAZfQ+zyV7bzKK6MvEWBdorcRNLWvKcv3OUiNqFWXjL1gNwrrwJSHD5jk6qLQVuTIKqjMY6Jkl3G+oaQr/Q+2FGkENiy478hLrBMfQFTol75ncsos7Bzck59UiZXY0BeNQ9oO7XQ0SonZgndb9FiQIDAQAB';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    action: {
      default_title: 'Open Atrium Capture',
    },
    description: 'Record and review visual workflows before saving a private Atrium draft.',
    host_permissions: ['<all_urls>'],
    key: manifestPublicKey,
    minimum_chrome_version: '116',
    name: 'Atrium Capture',
    optional_permissions: ['nativeMessaging'],
    permissions: ['identity', 'sidePanel', 'storage', 'unlimitedStorage'],
    storage: {
      managed_schema: 'managed-storage-schema.json',
    },
  },
});
