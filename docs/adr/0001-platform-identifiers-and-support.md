# ADR 0001: Platform identifiers and initial support floor

- Status: accepted
- Date: 2026-07-22

## Context

Stable browser and native identifiers are prerequisites for OAuth redirect registration, managed deployment, Keychain access groups, and durable local storage. The initial scaffold deliberately deferred the Mac package until these decisions were recorded.

## Decision

- Chrome extension ID: `jldnpmcpimhabiphcglkbgmbffpoocpo`.
- Chrome manifest public key: `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlTvrb5kWrnpWNisHiDz2FXYjwWQBbLgkJXHaMs2p4zv6OQwk3YeFX48spx/Wg1PgyXGVbqGi8xIGTq53/XbfLBLgsp5uIbC26YuIVEob5DpBXagBRikQ0igDN6NTKyQ20Sz6ynvM+u7Uw+pJnLm/crnvkjotxvAcArLC/3RJQVGcY3HqUSWTRTDbCumbSwfmiQAZfQ+zyV7bzKK6MvEWBdorcRNLWvKcv3OUiNqFWXjL1gNwrrwJSHD5jk6qLQVuTIKqjMY6Jkl3G+oaQr/Q+2FGkENiy478hLrBMfQFTol75ncsos7Bzck59UiZXY0BeNQ9oO7XQ0SonZgndb9FiQIDAQAB`.
- Browser OAuth redirect: `https://jldnpmcpimhabiphcglkbgmbffpoocpo.chromiumapp.org/atrium`.
- macOS bundle identifier: `org.psd401.AtriumCapture`.
- Minimum macOS version: macOS 14 Sonoma.
- Native OAuth callback: `org.psd401.atrium-capture:/oauth/callback`.
- Signing team remains an external district credential and is never committed. Release archives use the district Apple Developer team and an MDM-delivered signed/notarized package.

The committed Chrome value is only the public key. No extension signing private key is stored in the repository.

## Consequences

The extension ID and OAuth redirects must not change after client registration. macOS 13 and older are outside the initial native support matrix. Atrium now documents both application profiles and callbacks; live OAuth remains capability-gated only until administrators create the two public clients and distribute their non-secret UUIDs.
