import { readdirSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

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

// Replaces the previous `pnpm licenses list --json --dev` (pnpm-only) with a direct
// scan of every installed third-party package under node_modules, including nested
// installs. First-party workspace packages (symlinked from inside the repository)
// are excluded, matching the previous report's scope.
const repoRoot = resolve(import.meta.dirname, '..');
const licensesByExpression = new Map();
const seen = new Set();

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses.map((l) => l && l.type).filter(Boolean);
    if (types.length === 1) return types[0];
    if (types.length > 1) return `(${types.join(' OR ')})`;
  }
  return 'Unknown';
}

function isFirstParty(dir) {
  const real = realpathSync(dir);
  return real.startsWith(repoRoot + sep) && !real.includes(`${sep}node_modules${sep}`);
}

function scan(nodeModulesDir) {
  if (!existsSync(nodeModulesDir)) return;
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const entryPath = join(nodeModulesDir, entry.name);
    const packageDirs = entry.name.startsWith('@')
      ? readdirSync(entryPath, { withFileTypes: true })
          .filter((e) => !e.name.startsWith('.'))
          .map((e) => join(entryPath, e.name))
      : [entryPath];
    for (const packageDir of packageDirs) {
      const manifestPath = join(packageDir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch {
        continue;
      }
      if (!pkg.name || isFirstParty(packageDir)) continue;
      const id = `${pkg.name}@${pkg.version}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const expression = licenseOf(pkg);
      if (!licensesByExpression.has(expression)) licensesByExpression.set(expression, []);
      licensesByExpression.get(expression).push(id);
      scan(join(packageDir, 'node_modules'));
    }
  }
}

scan(join(repoRoot, 'node_modules'));

if (seen.size === 0) {
  throw new Error('No installed packages found; run bun install first.');
}

const licenses = [...licensesByExpression.keys()];
const disallowed = licenses.filter(
  (license) => !allowedLicenses.has(license) && !reviewedExpressions.has(license),
);

if (disallowed.length > 0) {
  const detail = disallowed
    .map((license) => `${license}: ${licensesByExpression.get(license).join(', ')}`)
    .join('\n');
  throw new Error(`Unreviewed dependency licenses:\n${detail}`);
}

console.log(
  `Dependency licenses are within the reviewed allowlist (${licenses.length} groups, ${seen.size} packages).`,
);
