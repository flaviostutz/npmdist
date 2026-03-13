import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { ManagedFileMetadata } from '../types';

import { purgeFileset } from './purge';
import { writeMarker, markerPath } from './markers';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npmdata-purge-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const makeEntry = (relPath: string): ManagedFileMetadata => ({
  path: relPath,
  packageName: 'mypkg',
  packageVersion: '1.0.0',
});

describe('purgeFileset', () => {
  it('returns zeros when outputDir does not exist', async () => {
    const result = await purgeFileset(path.join(tmpDir, 'missing'), [], false);
    expect(result).toEqual({ deleted: 0, symlinksRemoved: 0, dirsRemoved: 0 });
  });

  it('deletes managed files from disk', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'README.md'), '# hello');

    const entries: ManagedFileMetadata[] = [makeEntry('README.md')];
    const result = await purgeFileset(outputDir, entries, false);

    expect(result.deleted).toBe(1);
    expect(fs.existsSync(path.join(outputDir, 'README.md'))).toBe(false);
  });

  it('counts files that would be deleted in dryRun but does not delete them', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'README.md'), '# hello');

    const entries: ManagedFileMetadata[] = [makeEntry('README.md')];
    const result = await purgeFileset(outputDir, entries, /* dryRun */ true);

    expect(result.deleted).toBe(1);
    // File should still exist
    expect(fs.existsSync(path.join(outputDir, 'README.md'))).toBe(true);
  });

  it('removes marker file after purge', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    // Write marker
    const mPath = markerPath(outputDir);
    await writeMarker(mPath, [makeEntry('README.md')]);
    expect(fs.existsSync(mPath)).toBe(true);

    await purgeFileset(outputDir, [makeEntry('README.md')], false);
    expect(fs.existsSync(mPath)).toBe(false);
  });

  it('does not delete marker in dryRun', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    const mPath = markerPath(outputDir);
    await writeMarker(mPath, [makeEntry('f.md')]);

    await purgeFileset(outputDir, [makeEntry('f.md')], true);
    expect(fs.existsSync(mPath)).toBe(true);
  });

  it('handles read-only files by chmod before delete', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, 'locked.md');
    fs.writeFileSync(filePath, 'data');
    fs.chmodSync(filePath, 0o444);

    const result = await purgeFileset(outputDir, [makeEntry('locked.md')], false);
    expect(result.deleted).toBe(1);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('skips entries whose files are absent', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    // Entry for a file that doesn't exist
    const result = await purgeFileset(outputDir, [makeEntry('ghost.md')], false);
    expect(result.deleted).toBe(0);
  });

  it('preserves marker entries for other packages when purging only one package', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    // Two files managed by two different packages share the same output directory
    fs.writeFileSync(path.join(outputDir, 'pkgA.md'), 'a');
    fs.writeFileSync(path.join(outputDir, 'pkgB.md'), 'b');

    const entryA: ManagedFileMetadata = {
      path: 'pkgA.md',
      packageName: 'pkgA',
      packageVersion: '1.0.0',
    };
    const entryB: ManagedFileMetadata = {
      path: 'pkgB.md',
      packageName: 'pkgB',
      packageVersion: '1.0.0',
    };

    const mPath = markerPath(outputDir);
    await writeMarker(mPath, [entryA, entryB]);

    // Purge only pkgA's entries — pkgB's entry must stay in the marker
    await purgeFileset(outputDir, [entryA], false);

    expect(fs.existsSync(path.join(outputDir, 'pkgA.md'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'pkgB.md'))).toBe(true);

    // Marker still exists and retains pkgB's entry
    expect(fs.existsSync(mPath)).toBe(true);
    const remaining = fs.readFileSync(mPath, 'utf8');
    expect(remaining).toContain('pkgB.md|pkgB|1.0.0');
    expect(remaining).not.toContain('pkgA.md');

    // Purge pkgB's entries — marker becomes empty and is deleted
    await purgeFileset(outputDir, [entryB], false);
    expect(fs.existsSync(path.join(outputDir, 'pkgB.md'))).toBe(false);
    expect(fs.existsSync(mPath)).toBe(false);
  });
});
