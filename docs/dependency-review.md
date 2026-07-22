# Dependency review

Review date: 2026-07-22. Registry metadata was checked before the initial install. Versions are exact in `package.json` and the lockfile; CI rejects high-severity advisories and licenses outside the reviewed permissive allowlist.

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

`quicktype-core` is used only during generation; generated files remain MIT-licensed project output. No dependency receives runtime capture data. A dependency upgrade requires re-running `pnpm licenses:check`, `pnpm security:audit`, all contract tests, and the affected application test suite.

The resolved development graph also includes `minimatch` under the permissive Blue Oak Model License 1.0.0 and `lightningcss` under MPL-2.0. Both are unmodified build-time dependencies: Blue Oak is permissive, and MPL-2.0 obligations remain file-scoped inside the dependency. Neither changes the MIT license of Atrium Capture source or generated artifacts.
