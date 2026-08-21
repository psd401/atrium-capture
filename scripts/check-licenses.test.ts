import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectInstalledLicenses } from './check-licenses.mjs';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'atrium-license-check-'));
  temporaryRoots.push(root);
  return root;
}

function writePackage(directory: string, name: string, license = 'MIT'): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', license }),
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('dependency license collection', () => {
  it('scans nested trees beneath duplicate package versions', () => {
    const root = temporaryRoot();
    writePackage(join(root, 'node_modules', 'duplicate'), 'duplicate');
    writePackage(join(root, 'node_modules', 'wrapper'), 'wrapper');
    writePackage(join(root, 'node_modules', 'wrapper', 'node_modules', 'duplicate'), 'duplicate');
    writePackage(
      join(
        root,
        'node_modules',
        'wrapper',
        'node_modules',
        'duplicate',
        'node_modules',
        'copyleft-only',
      ),
      'copyleft-only',
      'GPL-3.0-only',
    );

    const { licensesByExpression } = collectInstalledLicenses(root);

    expect(licensesByExpression.get('GPL-3.0-only')).toEqual(['copyleft-only@1.0.0']);
  });

  it('scans third-party dependencies nested beneath first-party workspaces', () => {
    const root = temporaryRoot();
    const workspace = join(root, 'packages', 'workspace');
    writePackage(workspace, '@atrium-capture/workspace');
    writePackage(
      join(workspace, 'node_modules', 'unreviewed'),
      'unreviewed',
      'LicenseRef-Unreviewed',
    );
    mkdirSync(join(root, 'node_modules', '@atrium-capture'), { recursive: true });
    symlinkSync(workspace, join(root, 'node_modules', '@atrium-capture', 'workspace'));

    const { licensesByExpression, packageCount } = collectInstalledLicenses(root);

    expect(packageCount).toBe(1);
    expect(licensesByExpression.get('LicenseRef-Unreviewed')).toEqual(['unreviewed@1.0.0']);
  });

  it('fails closed when an installed package manifest is malformed', () => {
    const root = temporaryRoot();
    const packageDirectory = join(root, 'node_modules', 'malformed');
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(join(packageDirectory, 'package.json'), '{');

    expect(() => collectInstalledLicenses(root)).toThrow(
      'Unable to parse installed package manifest',
    );
  });

  it('fails closed on a stale pnpm dependency tree', () => {
    const root = temporaryRoot();
    mkdirSync(join(root, 'node_modules', '.pnpm'), { recursive: true });

    expect(() => collectInstalledLicenses(root)).toThrow('pnpm-managed node_modules detected');
  });
});
