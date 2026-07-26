# ADR 0001: Platform identifiers and initial support floor

- Status: amended by ADR 0009
- Date: 2026-07-22

## Context

Stable browser and native identifiers are prerequisites for OAuth redirect registration, managed deployment, Keychain access groups, and durable local storage. The initial scaffold deliberately deferred the Mac package until these decisions were recorded.

## Decision

- Chrome extension ID: `eomlblaiglafndhplfhilmdcaofhkkbj`.
- Chrome manifest public key: `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAksSbIbmfC3UWDB+TA+lbYyK8s/xGppbKSVPLSls82vmW7xqMz2gWkPR2yzRkgtq+/dvbggC/BebC9WqWnt7zg8649A5JntepAuidmQd3bjCXEFtBfGNuAVwGyI6mPnuMKrC0XMn2TTe/mAcTkmJJ/w3qAv78GcFkDS57xHE+GxnPolnu+UaWVV7b1QJpmw05NsLmC0XnSSxT5052A+BK2pb0/Uq5z7dQ+hzDumg1ZLDv+knZDRHcn5ZUx/S0xcYk+OOup1BSI+WrgNtiA1iBPnNLiHLhCQpNiYSLOx6EC8XqILNXl7Gan61Tw08cjgiBY9PTOl38nK7yMOi9LmzlXQIDAQAB`.
- Browser OAuth redirect: `https://eomlblaiglafndhplfhilmdcaofhkkbj.chromiumapp.org/atrium`.
- macOS bundle identifier: `org.psd401.AtriumCapture`.
- Minimum macOS version: macOS 14 Sonoma.
- Native OAuth callback: `org.psd401.atrium-capture:/oauth/callback`.
- Signing team remains an external district credential and is never committed. Release archives use the district Apple Developer team and an MDM-delivered signed/notarized package.

The committed Chrome value is only the public key. No extension signing private key is stored in the repository.

## Consequences

The Web Store-assigned extension ID and OAuth redirects must not change after
the migration in ADR 0009. macOS 13 and older are outside the initial native
support matrix. Atrium documents both application profiles and callbacks, and
the registered non-secret UUIDs are bundled. Browser OAuth remains
capability-gated until Atrium permits the exact stable
`chrome-extension://eomlblaiglafndhplfhilmdcaofhkkbj` token-request origin for
that exact client.
