# Disabled Firefox runner

Atrium Capture v1 targets Chrome. Current WXT depends on `web-ext-run`, whose otherwise unused Firefox launcher depends on a `shell-quote` release with unresolved high/critical advisories and no published patched release.

The root pnpm override replaces only `fx-runner` with this dependency-free fail-closed module. Chrome builds, Chrome development, and extension-loaded Chromium tests do not call it. A future Firefox target must remove the override only after the upstream advisory has a patched dependency path.
