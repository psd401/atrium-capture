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
const disallowed = [...new Set(licenses)].filter((license) => !allowedLicenses.has(license));

if (disallowed.length > 0) {
  throw new Error(`Unreviewed dependency licenses: ${disallowed.join(', ')}`);
}

console.log(`Dependency licenses are within the reviewed allowlist (${licenses.length} groups).`);
