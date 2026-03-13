import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { readMarker, writeMarker, markerPath, readOutputDirMarker } from './markers';
import { MARKER_FILE } from './constants';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npmdata-markers-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('markerPath', () => {
  it('returns the path to the marker file in the given directory', () => {
    const result = markerPath('/some/dir');
    expect(result).toBe(path.join('/some/dir', MARKER_FILE));
  });
});

describe('readMarker', () => {
  it('returns empty array when marker file does not exist', async () => {
    const result = await readMarker(path.join(tmpDir, '.npmdata'));
    expect(result).toEqual([]);
  });

  it('parses CSV rows into ManagedFileMetadata entries', async () => {
    const mPath = path.join(tmpDir, '.npmdata');
    fs.writeFileSync(mPath, 'README.md|mypkg|1.0.0\ndocs/guide.md|mypkg|1.0.0\n');
    const result = await readMarker(mPath);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ path: 'README.md', packageName: 'mypkg', packageVersion: '1.0.0' });
    expect(result[1]).toEqual({
      path: 'docs/guide.md',
      packageName: 'mypkg',
      packageVersion: '1.0.0',
    });
  });

  it('skips blank lines in marker file', async () => {
    const mPath = path.join(tmpDir, '.npmdata');
    fs.writeFileSync(mPath, 'a.md|pkg|1.0.0\n\nb.md|pkg|1.0.0\n');
    const result = await readMarker(mPath);
    expect(result).toHaveLength(2);
  });

  it('falls back to empty string for missing fields in malformed rows', async () => {
    const mPath = path.join(tmpDir, '.npmdata');
    // Line with only one field — packageName and packageVersion will be undefined → ''
    fs.writeFileSync(mPath, 'only-path\n');
    const result = await readMarker(mPath);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('only-path');
    expect(result[0].packageName).toBe('');
    expect(result[0].packageVersion).toBe('');
  });

  it('correctly parses file paths that contain commas', async () => {
    // Pipe separator means commas in file paths are never ambiguous.
    const mPath = path.join(tmpDir, '.npmdata');
    fs.writeFileSync(mPath, 'src/my,util.ts|mypkg|1.0.0\n');
    const result = await readMarker(mPath);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('src/my,util.ts');
    expect(result[0].packageName).toBe('mypkg');
    expect(result[0].packageVersion).toBe('1.0.0');
  });
});

describe('writeMarker', () => {
  it('creates a marker file with pipe-separated rows and makes it read-only', async () => {
    const mPath = path.join(tmpDir, '.npmdata');
    await writeMarker(mPath, [
      { path: 'README.md', packageName: 'mypkg', packageVersion: '1.2.3' },
    ]);
    expect(fs.existsSync(mPath)).toBe(true);
    const content = fs.readFileSync(mPath, 'utf8');
    expect(content).toContain('README.md|mypkg|1.2.3');
    const stat = fs.statSync(mPath);
    // read-only: owner write bit should be off

    expect(stat.mode & 0o200).toBe(0);
  });

  it('removes existing marker file when writing empty entries', async () => {
    const mPath = path.join(tmpDir, '.npmdata');
    // Create the file first
    await writeMarker(mPath, [{ path: 'a.md', packageName: 'pkg', packageVersion: '1.0.0' }]);
    expect(fs.existsSync(mPath)).toBe(true);

    // Writing empty entries should delete the file
    await writeMarker(mPath, []);
    expect(fs.existsSync(mPath)).toBe(false);
  });

  it('does nothing when writing empty entries and file does not exist', async () => {
    const mPath = path.join(tmpDir, '.npmdata');
    await writeMarker(mPath, []);
    expect(fs.existsSync(mPath)).toBe(false);
  });

  it('overwrites existing marker file with new entries', async () => {
    const mPath = path.join(tmpDir, '.npmdata');
    await writeMarker(mPath, [{ path: 'old.md', packageName: 'pkg', packageVersion: '1.0.0' }]);
    await writeMarker(mPath, [{ path: 'new.md', packageName: 'pkg', packageVersion: '2.0.0' }]);
    const content = fs.readFileSync(mPath, 'utf8');
    expect(content).toContain('new.md');
    expect(content).not.toContain('old.md');
  });

  it('creates intermediate directories if they do not exist', async () => {
    const mPath = path.join(tmpDir, 'nested', 'dir', '.npmdata');
    await writeMarker(mPath, [{ path: 'a.md', packageName: 'pkg', packageVersion: '1.0.0' }]);
    expect(fs.existsSync(mPath)).toBe(true);
  });
});

describe('readOutputDirMarker', () => {
  it('returns empty array when no marker exists in output dir', async () => {
    const result = await readOutputDirMarker(tmpDir);
    expect(result).toEqual([]);
  });

  it('reads entries from the output dir marker file', async () => {
    const mPath = markerPath(tmpDir);
    await writeMarker(mPath, [{ path: 'doc.md', packageName: 'p', packageVersion: '0.1.0' }]);
    const result = await readOutputDirMarker(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('doc.md');
  });
});
