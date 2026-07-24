# Security and privacy

Atrium Capture is intended for a K-12 district. Privacy behavior is a release gate, not a preference.

## Capture defaults

- Recording begins only after an explicit user action and remains visibly indicated.
- Password fields and their values are never captured.
- Ordinary input steps record intent, not literal values.
- Raw page HTML, network traffic, cookies, local storage, and form state are out of scope.
- Source URL retention defaults to origin-only or none; query strings and fragments are excluded.
- Site allow/deny policy is evaluated before listeners are activated.

## Screenshot lifecycle

1. A raw screenshot exists locally for the active session.
2. Automated detections flag likely sensitive regions.
3. The author reviews/edits redactions.
4. Export creates a new flattened raster, strips metadata, and marks that derivative publishable.
5. Only the publishable derivative may enter the Atrium outbox.
6. The default local policy deletes raw originals atomically when flattened derivatives are finalized. A managed policy may retain them until successful submission, but raw assets never enter the outbox.
7. Managed policy is read only in trusted extension contexts and is validated again by the worker. Malformed configured policy disables capture and forces URL retention to none.
8. Support diagnostics contain operational counts and capability/error codes only; they never contain capture text, URLs, identifiers, tokens, or pixels and are never transmitted automatically.
9. On macOS, a publishable PNG is written and its raw tombstone is persisted before raw-file deletion. An interrupted delete can leave a non-publishable orphan but cannot expose it to the outbox.

Blur is not sufficient for secrets that must be irrecoverable; permanent redaction uses opaque replacement pixels. Tests must inspect the output bytes, not only the on-screen preview.

## Authentication

- Chrome: Authorization Code + PKCE through `chrome.identity.launchWebAuthFlow()`.
- Mac: Authorization Code + PKCE through `ASWebAuthenticationSession`.
- No permanent `sk-` key and no OAuth client secret in either application.
- Browser access/refresh tokens live in trusted-only extension session storage; content scripts never receive them and a full browser exit clears them.
- Mac refresh credentials live in Keychain.

Both clients use the fixed production issuer and a bundled approved public client UUID. Optional managed preferences may override only that non-secret identifier for an approved test client. OAuth responses are bounded and validated as Bearer tokens; refresh rotation is serialized. The Mac credential record is stored through SecItem off the main thread. Tokens never enter session JSON, native messages, diagnostics, or console output.

## Permissions

Use the smallest practical browser permission set. Continuous, cross-site recording may require broad optional/managed host access; explain it plainly and activate capture only during a user-started session. Add `nativeMessaging` only with the Mac bridge release, not preemptively.

The production extension displays its permission rationale in-product. `unlimitedStorage` is bounded by a smaller managed image budget, and `identity` is used only from the explicit **Sign in to AI Studio** action.

Mac permissions are staged and explained at point of use: Screen Recording for pixels and Accessibility for semantic UI metadata. The app remains usable for screenshot editing when either permission is denied.

The optional Chrome-to-Mac bridge requests its warning-bearing permission from a user gesture. It forwards action, timestamp, role, and accessible name only. Browser URLs/selectors, screenshots, form values, authorization data, and tokens are omitted. Disabling it removes the optional permission.

## Network boundary

Atrium is the only production data destination. The authored-asset flow sends reviewed bytes directly to an Atrium-issued S3 URL, using only its constrained headers and never the bearer token. No analytics, external AI provider, private image host, or crash reporter may receive capture content without a separate approved privacy decision.
