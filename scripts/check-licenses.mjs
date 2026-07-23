import { spawnSync } from 'node:child_process';

const allowedLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MPL-2.0',
  'Zlib',
]);

// These exact metadata expressions were manually reviewed. OR expressions select the listed
// permissive option; pako's MIT AND Zlib terms are both permissive. "BSD" is winreg's legacy
// package metadata for its BSD-licensed, development-only WXT dependency.
const reviewedExpressions = new Set([
  '(BSD-2-Clause OR MIT OR Apache-2.0)',
  '(BSD-3-Clause OR GPL-2.0)',
  '(MIT AND Zlib)',
  '(MIT OR CC0-1.0)',
  '(MIT OR GPL-3.0-or-later)',
  'BSD',
]);

const result = spawnSync('pnpm', ['licenses', 'list', '--json', '--dev'], {
  encoding: 'utf8',
  shell: false,
});

if (result.status !== 0) {
  throw new Error(result.stderr || 'pnpm licenses list failed');
}

const report = JSON.parse(result.stdout);
const licenses = Array.isArray(report) ? report.map((entry) => entry.license) : Object.keys(report);
const disallowed = [...new Set(licenses)].filter(
  (license) => !allowedLicenses.has(license) && !reviewedExpressions.has(license),
);

if (disallowed.length > 0) {
  throw new Error(`Unreviewed dependency licenses: ${disallowed.join(', ')}`);
}

console.log(`Dependency licenses are within the reviewed allowlist (${licenses.length} groups).`);
