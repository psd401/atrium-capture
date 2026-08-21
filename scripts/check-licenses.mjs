import { readdirSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

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

export function collectInstalledLicenses(repoRoot) {
  const realRepoRoot = realpathSync(repoRoot);
  if (existsSync(join(realRepoRoot, 'node_modules', '.pnpm'))) {
    throw new Error(
      'pnpm-managed node_modules detected; remove it and run bun install before checking licenses.',
    );
  }
  const licensesByExpression = new Map();
  const seen = new Set();
  const scannedNodeModules = new Set();

  function isFirstParty(dir) {
    const real = realpathSync(dir);
    return real.startsWith(realRepoRoot + sep) && !real.includes(`${sep}node_modules${sep}`);
  }

  function scan(nodeModulesDir) {
    if (!existsSync(nodeModulesDir)) return;
    const realNodeModulesDir = realpathSync(nodeModulesDir);
    if (scannedNodeModules.has(realNodeModulesDir)) return;
    scannedNodeModules.add(realNodeModulesDir);

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
        } catch (error) {
          throw new Error(`Unable to parse installed package manifest ${manifestPath}`, {
            cause: error,
          });
        }
        if (!pkg.name || !pkg.version) {
          throw new Error(`Installed package manifest lacks a name or version: ${manifestPath}`);
        }

        if (!isFirstParty(packageDir)) {
          const id = `${pkg.name}@${pkg.version}`;
          if (!seen.has(id)) {
            seen.add(id);
            const expression = licenseOf(pkg);
            if (!licensesByExpression.has(expression)) licensesByExpression.set(expression, []);
            licensesByExpression.get(expression).push(id);
          }
        }

        // A duplicate package or first-party workspace may still contain a distinct nested
        // dependency tree, so always traverse it even when its own license is already known.
        scan(join(packageDir, 'node_modules'));
      }
    }
  }

  scan(join(repoRoot, 'node_modules'));
  return { licensesByExpression, packageCount: seen.size };
}

function main() {
  const repoRoot = resolve(import.meta.dirname, '..');
  const { licensesByExpression, packageCount } = collectInstalledLicenses(repoRoot);

  if (packageCount === 0) {
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
    `Dependency licenses are within the reviewed allowlist (${licenses.length} groups, ${packageCount} packages).`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
