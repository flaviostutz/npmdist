import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ManagedFileMetadata } from '../types';

import { diff } from './diff';

describe('diff', () => {
  let tmpDir: string;
  let pkgDir: string;
  let outputDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-diff-test-'));
    pkgDir = path.join(tmpDir, 'pkg');
    outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  const writeFile = (dir: string, relPath: string, content: string): void => {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  };

  it('classifies new file as toAdd', async () => {
    writeFile(pkgDir, 'docs/guide.md', '# Guide');
    const result = await diff(pkgDir, outputDir, { files: ['**'] }, { path: '.' }, [], []);
    expect(result.toAdd).toHaveLength(1);
    expect(result.toAdd[0].relPath).toBe('docs/guide.md');
    expect(result.toModify).toHaveLength(0);
    expect(result.toDelete).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('classifies changed managed file as toModify', async () => {
    writeFile(pkgDir, 'guide.md', 'new content');
    writeFile(outputDir, 'guide.md', 'old content');
    const marker: ManagedFileMetadata[] = [
      { path: 'guide.md', packageName: 'my-pkg', packageVersion: '1.0.0' },
    ];
    const result = await diff(pkgDir, outputDir, { files: ['**'] }, { path: '.' }, marker, []);
    expect(result.toModify).toHaveLength(1);
    expect(result.toModify[0].relPath).toBe('guide.md');
    expect(result.toAdd).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('classifies removed managed file as toDelete', async () => {
    writeFile(outputDir, 'old.md', 'old content');
    const marker: ManagedFileMetadata[] = [
      { path: 'old.md', packageName: 'my-pkg', packageVersion: '1.0.0' },
    ];
    const result = await diff(pkgDir, outputDir, { files: ['**'] }, { path: '.' }, marker, []);
    expect(result.toDelete).toContain('old.md');
    expect(result.toAdd).toHaveLength(0);
  });

  it('classifies unmanaged existing file as conflict (without force)', async () => {
    writeFile(pkgDir, 'guide.md', 'pkg content');
    writeFile(outputDir, 'guide.md', 'user content');
    const result = await diff(
      pkgDir,
      outputDir,
      { files: ['**'] },
      { path: '.', force: false },
      [],
      [],
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].relPath).toBe('guide.md');
    expect(result.toAdd).toHaveLength(0);
  });

  it('classifies unmanaged existing file as toModify when force=true', async () => {
    writeFile(pkgDir, 'guide.md', 'pkg content');
    writeFile(outputDir, 'guide.md', 'user content');
    const result = await diff(
      pkgDir,
      outputDir,
      { files: ['**'] },
      { path: '.', force: true },
      [],
      [],
    );
    expect(result.toModify).toHaveLength(1);
    expect(result.conflicts).toHaveLength(0);
  });

  it('skips existing files when keepExisting=true', async () => {
    writeFile(pkgDir, 'guide.md', 'pkg content');
    writeFile(outputDir, 'guide.md', 'user content');
    const result = await diff(
      pkgDir,
      outputDir,
      { files: ['**'] },
      { path: '.', keepExisting: true },
      [],
      [],
    );
    expect(result.toSkip).toHaveLength(1);
    expect(result.toSkip[0].reason).toBe('keep-existing');
    expect(result.toAdd).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('in unmanaged mode, skips existing files', async () => {
    writeFile(pkgDir, 'guide.md', 'pkg content');
    writeFile(outputDir, 'guide.md', 'user content');
    const result = await diff(
      pkgDir,
      outputDir,
      { files: ['**'] },
      { path: '.', unmanaged: true },
      [],
      [],
    );
    expect(result.toSkip).toHaveLength(1);
    expect(result.toSkip[0].reason).toBe('unmanaged');
    expect(result.toAdd).toHaveLength(0);
  });

  it('in unmanaged mode, adds new files to toAdd', async () => {
    writeFile(pkgDir, 'new.md', 'new content');
    const result = await diff(
      pkgDir,
      outputDir,
      { files: ['**'] },
      { path: '.', unmanaged: true },
      [],
      [],
    );
    expect(result.toAdd).toHaveLength(1);
    expect(result.toAdd[0].relPath).toBe('new.md');
  });

  it('unchanged managed file is skipped (not toModify)', async () => {
    writeFile(pkgDir, 'guide.md', 'same content');
    writeFile(outputDir, 'guide.md', 'same content');
    const marker: ManagedFileMetadata[] = [
      { path: 'guide.md', packageName: 'my-pkg', packageVersion: '1.0.0' },
    ];
    const result = await diff(pkgDir, outputDir, { files: ['**'] }, { path: '.' }, marker, []);
    expect(result.toSkip).toHaveLength(1);
    expect(result.toModify).toHaveLength(0);
  });

  it('unmanaged set does not delete marker entries outside its selection', async () => {
    // Simulates the split-set pattern: Set 1 (managed) extracted file-a.md and
    // file-b.md for the package; Set 2 (unmanaged) runs for the same package
    // and output but only selects file-b.md. Set 2 must NOT schedule file-a.md
    // for deletion even though it is in the existing marker.
    writeFile(pkgDir, 'file-b.md', 'b content');
    writeFile(outputDir, 'file-a.md', 'a content');
    writeFile(outputDir, 'file-b.md', 'b content');
    const marker: ManagedFileMetadata[] = [
      { path: 'file-a.md', packageName: 'my-pkg', packageVersion: '1.0.0' },
      { path: 'file-b.md', packageName: 'my-pkg', packageVersion: '1.0.0' },
    ];
    const result = await diff(
      pkgDir,
      outputDir,
      { files: ['file-b.md'] },
      { path: '.', unmanaged: true },
      marker,
      [],
    );
    expect(result.toDelete).toHaveLength(0);
    expect(result.toSkip).toHaveLength(1); // file-b.md skipped (unmanaged, exists)
    expect(result.toAdd).toHaveLength(0);
  });
});
