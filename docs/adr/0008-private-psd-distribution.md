# ADR 0008: private PSD-managed distribution

- Status: accepted
- Date: 2026-07-25

## Context

Atrium Capture is intended for district employees, not the public. A locally
unpacked extension is useful for engineering, but it is not a signed artifact
that can be installed safely and updated across 1,000 managed users. A locally
packed CRX on macOS is not a substitute for Chrome Web Store or enterprise
managed distribution. Likewise, an ad-hoc Mac signature changes identity across
rebuilds and cannot retain durable Screen Recording and Accessibility grants.

The repository already locks the browser extension ID and macOS bundle ID
because both participate in production OAuth registration. Signing credentials
must remain outside the repository.

## Decision

- Publish the browser extension as a **private PSD-only Chrome Web Store item**.
  It must not be publicly listed. The district Chrome Admin console promotes
  that signed item through engineering, support, pilot, and broad managed
  rings.
- Do not operate a private CRX update server. The Chrome Web Store owns browser
  signing and update delivery; PSD policy owns who can install the item.
- Before upload, verify whether the private store item owns the committed
  extension ID `jldnpmcpimhabiphcglkbgmbffpoocpo`. If it does not, stop and
  coordinate a versioned extension-ID and Atrium OAuth registration migration.
  Never generate a replacement signing key silently.
- An Apple Development signature from an authorized developer is sufficient for
  a local pilot installed at a stable path. Broad managed Mac distribution
  requires the district's Developer ID Application identity, notarization, and
  MDM promotion.
- `pnpm check` proves engineering quality but does not claim release readiness.
  `pnpm verify:pilot` additionally requires a receipt matching the exact signed,
  published, PSD-only store item and a stable Apple-signed Mac app.
  `pnpm verify:distribution` further requires a Developer ID signature accepted
  by Gatekeeper.

## Consequences

Employees sign in only to AI Studio during normal publishing. They never see
publisher credentials, ClassLink publisher setup, signing keys, or manual
extension configuration. Public discovery is disabled. Store and MDM operators
can roll back to the last approved signed version without introducing another
capture-data service or weakening the direct-to-Atrium privacy boundary.
