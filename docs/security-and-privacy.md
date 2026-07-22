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
6. Raw originals are deleted after successful submission or the configured local retention window.

Blur is not sufficient for secrets that must be irrecoverable; permanent redaction uses opaque replacement pixels. Tests must inspect the output bytes, not only the on-screen preview.

## Authentication

- Chrome: Authorization Code + PKCE through `chrome.identity.launchWebAuthFlow()`.
- Mac: Authorization Code + PKCE through `ASWebAuthenticationSession`.
- No permanent `sk-` key and no OAuth client secret in either application.
- Browser access tokens live only in trusted extension contexts; content scripts never receive them.
- Mac refresh credentials live in Keychain.

## Permissions

Use the smallest practical browser permission set. Continuous, cross-site recording may require broad optional/managed host access; explain it plainly and activate capture only during a user-started session. Add `nativeMessaging` only with the Mac bridge release, not preemptively.

Mac permissions are staged and explained at point of use: Screen Recording for pixels and Accessibility for semantic UI metadata. The app remains usable for screenshot editing when either permission is denied.

## Network boundary

Atrium is the only production data destination. No analytics, external AI provider, image host, or crash reporter may receive capture content without a separate approved privacy decision.
