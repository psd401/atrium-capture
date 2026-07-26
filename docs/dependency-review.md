# Dependency review

Review date: 2026-07-24. Registry metadata was checked before the initial install and again for security overrides. Versions are exact in `package.json` and the lockfile; CI rejects high-severity advisories and licenses outside the reviewed permissive allowlist.

| Direct development dependency    |         Version | License    | Maintenance/security posture and purpose                                                 |
| -------------------------------- | --------------: | ---------- | ---------------------------------------------------------------------------------------- |
| TypeScript                       |           6.0.3 | Apache-2.0 | Current TypeScript 6 release supported by typescript-eslint; strict static checking only |
| AJV                              |          8.20.0 | MIT        | Actively maintained JSON Schema 2020-12 validator used at trust boundaries               |
| ajv-formats                      |           3.0.1 | MIT        | Small official AJV companion for UUID/URI/date-time format checks                        |
| quicktype-core                   |          26.0.0 | Apache-2.0 | Current release; deterministic TypeScript and Swift generation from committed schemas    |
| Vitest                           |          4.1.10 | MIT        | Current Node 24-compatible unit test runner                                              |
| ESLint / `@eslint/js`            | 10.7.0 / 10.0.1 | MIT        | Current lint engine and official rule definitions                                        |
| typescript-eslint                |          8.65.0 | MIT        | Current release supporting ESLint 10 and TypeScript below 6.1                            |
| Prettier                         |           3.9.6 | MIT        | Current deterministic formatter                                                          |
| Node type declarations / globals | 26.1.1 / 17.7.0 | MIT        | Build-time declarations only                                                             |
| WXT / React module               | 0.20.27 / 1.2.2 | MIT        | Maintained Manifest V3 build system and official React integration                       |
| React / React DOM                |          19.2.8 | MIT        | Side-panel UI only; no page-context or network access                                    |
| idb                              |           8.0.3 | ISC        | Small maintained IndexedDB promise wrapper for transactional persistence                 |
| Playwright                       |          1.61.1 | Apache-2.0 | Extension-loaded Chromium integration and service-worker restart tests                   |
| fake-indexeddb                   |           6.2.5 | Apache-2.0 | Test-only IndexedDB implementation for deterministic recovery tests                      |
| esbuild                          |          0.28.1 | MIT        | Patched browser-test bundler and WXT/Vite transitive resolution; development only        |
| adm-zip                          |           0.6.0 | MIT        | Maintained build-only ZIP writer used to make store-upload archives byte-reproducible    |

`quicktype-core` is used only during generation; generated files remain MIT-licensed project output. No dependency receives runtime capture data. A dependency upgrade requires re-running `pnpm licenses:check`, `pnpm security:audit`, all contract tests, and the affected application test suite.

GitHub workflows pin the official MIT-licensed `actions/checkout` v7.0.1 commit (`3d3c42e5aac5ba805825da76410c181273ba90b1`). This Node 24-compatible release is active and unarchived; it replaces the mutable Node 20-based v4 reference that GitHub deprecated.

The resolved development graph also includes `minimatch` under the permissive Blue Oak Model License 1.0.0 and `lightningcss` under MPL-2.0. Both are unmodified build-time dependencies: Blue Oak is permissive, and MPL-2.0 obligations remain file-scoped inside the dependency. Neither changes the MIT license of Atrium Capture source or generated artifacts.

WXT's development-only packaging graph includes a small number of dual-license expressions. Atrium Capture selects the permissive alternative for JSZip (MIT), node-forge (BSD-3-Clause), `rc` (BSD-2-Clause/MIT/Apache-2.0), and type-fest (MIT/CC0); pako's combined MIT and Zlib terms are both permissive. `winreg@0.0.12` declares the legacy identifier `BSD` rather than a modern SPDX variant and is used only by cross-platform development tooling; that exact package/version is explicitly reviewed. The license checker allows these exact expressions so a new or changed expression still fails closed.

WXT 0.20.27's Firefox runner requested vulnerable historical ranges of
`adm-zip`, `shell-quote`, `tmp`, and a notification-only `uuid` dependency.
Root pnpm overrides select patched `adm-zip@0.6.0`, `tmp@0.2.7`, and
`uuid@11.1.1`. The same current MIT-licensed `adm-zip` release is now a direct
build-only dependency for deterministic Web Store archives; registry metadata
was rechecked on 2026-07-25 and the security audit remains the release gate. No
patched `shell-quote` release exists, so the Chrome-only
workspace replaces the unused `fx-runner` package with a dependency-free,
fail-closed local module; Firefox development is deliberately unavailable. A
root `esbuild@0.28.1` override also closes the development-server advisory
inherited through Vite. On 2026-07-24, registry advisory
`GHSA-mh99-v99m-4gvg` affected every resolved historical `brace-expansion`
range through ESLint/minimatch and WXT's development runner. The root override
now selects MIT-licensed `brace-expansion@5.0.8`, which provides both ESM and
CommonJS exports and supports the repository's Node 24 baseline. The complete
lint/build/test/package/license gate and `pnpm security:audit` pass against that
resolution. None of these build-only packages is present in the production
extension bundle.
