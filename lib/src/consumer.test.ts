/* eslint-disable no-restricted-syntax */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

import archiver from 'archiver';

import { extract, check } from './consumer';
import { readCsvMarker } from './utils';

describe('Consumer', () => {
  // eslint-disable-next-line functional/no-let
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consumer-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  describe('extract', () => {
    it('should extract files from package to output directory', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-extract-package',
        {
          'README.md': '# Test Package',
          'docs/guide.md': '# Guide',
          'src/index.ts': 'export const test = true;',
        },
        tmpDir,
      );

      await extract({
        packageName: 'test-extract-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**'],
      });

      // Verify files were extracted
      expect(fs.existsSync(path.join(outputDir, 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'src', 'index.ts'))).toBe(true);

      // Verify marker was created
      expect(fs.existsSync(path.join(outputDir, '.publisher'))).toBe(true);

      const rootMarker = readCsvMarker(path.join(outputDir, '.publisher'));
      expect(rootMarker.some((m) => m.packageName === 'test-extract-package')).toBe(true);

      const docsMarker = readCsvMarker(path.join(outputDir, 'docs', '.publisher'));
      expect(docsMarker[0].packageName).toBe('test-extract-package');

      const srcMarker = readCsvMarker(path.join(outputDir, 'src', '.publisher'));
      expect(srcMarker[0].packageName).toBe('test-extract-package');
    });

    it('should mark extracted files as read-only', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-readonly-package',
        {
          'template.md': '# Template',
        },
        tmpDir,
      );

      await extract({
        packageName: 'test-readonly-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      const extractedFile = path.join(outputDir, 'template.md');
      expect(fs.existsSync(extractedFile)).toBe(true);

      const stats = fs.statSync(extractedFile);
      // eslint-disable-next-line no-bitwise
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o444);
    });

    it('should update managed files on second extraction of the same package', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('test-update-package', { 'docs/guide.md': '# Guide v1' }, tmpDir);

      await extract({
        packageName: 'test-update-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Re-install same package (simulate update) and extract again
      await extract({
        packageName: 'test-update-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);
    });

    it('should be idempotent: running extraction twice produces no changes on the second run', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-idempotent-package',
        {
          'README.md': '# Idempotent Package',
          'docs/guide.md': '# Guide',
          'docs/api.md': '# API',
          'src/index.ts': 'export const value = 42;',
        },
        tmpDir,
      );

      // First extraction
      await extract({
        packageName: 'test-idempotent-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**'],
      });

      // Capture file contents and modification times after first extraction
      const snapshotMtimes: Record<string, number> = {};
      const snapshotContents: Record<string, string> = {};
      const filesToSnapshot = [
        path.join(outputDir, 'README.md'),
        path.join(outputDir, 'docs', 'guide.md'),
        path.join(outputDir, 'docs', 'api.md'),
        path.join(outputDir, 'src', 'index.ts'),
      ];
      for (const f of filesToSnapshot) {
        // eslint-disable-next-line functional/immutable-data
        snapshotMtimes[f] = fs.statSync(f).mtimeMs;
        // eslint-disable-next-line functional/immutable-data
        snapshotContents[f] = fs.readFileSync(f, 'utf8');
      }

      // Second extraction with identical package and output dir
      const secondResult = await extract({
        packageName: 'test-idempotent-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**'],
      });

      // No files should be added, modified, or deleted on second run; all should be skipped
      expect(secondResult.added).toHaveLength(0);
      expect(secondResult.modified).toHaveLength(0);
      expect(secondResult.deleted).toHaveLength(0);
      expect(secondResult.skipped.length).toBeGreaterThan(0);

      // File contents must be identical
      for (const f of filesToSnapshot) {
        expect(fs.readFileSync(f, 'utf8')).toBe(snapshotContents[f]);
      }

      // Files must not have been touched (same mtime)
      for (const f of filesToSnapshot) {
        expect(fs.statSync(f).mtimeMs).toBe(snapshotMtimes[f]);
      }
    });

    it('should throw on file conflict with unmanaged existing file', async () => {
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });

      // Pre-create an unmanaged file at the conflict path
      fs.writeFileSync(path.join(outputDir, 'config.md'), 'existing unmanaged content');

      await installMockPackage('test-conflict-package', { 'config.md': '# Config' }, tmpDir);

      await expect(
        extract({
          packageName: 'test-conflict-package',
          outputDir,
          packageManager: 'pnpm',
          cwd: tmpDir,
        }),
      ).rejects.toThrow('File conflict');
    });

    it('should overwrite unmanaged file when force is true', async () => {
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });

      fs.writeFileSync(path.join(outputDir, 'overwrite.md'), 'pre-existing content');

      await installMockPackage(
        'test-allow-conflicts-package',
        { 'overwrite.md': '# New content' },
        tmpDir,
      );

      const result = await extract({
        packageName: 'test-allow-conflicts-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        force: true,
      });

      expect(result.added.length + result.modified.length).toBeGreaterThan(0);
      const content = fs.readFileSync(path.join(outputDir, 'overwrite.md'), 'utf8');
      expect(content).toBe('# New content');
    });

    it('should filter files by filenamePatterns', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-filter-package',
        {
          'docs/guide.md': '# Guide',
          'src/index.ts': 'export {}',
        },
        tmpDir,
      );

      await extract({
        packageName: 'test-filter-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**/*.md'],
      });

      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'src', 'index.ts'))).toBe(false);
    });

    it('should remove deleted file entry from metadata when package drops a file', async () => {
      const outputDir = path.join(tmpDir, 'output');

      // First extraction: package has two files in the same directory
      await installMockPackage(
        'test-delete-meta-package',
        {
          'docs/file1.md': '# File 1',
          'docs/file2.md': '# File 2',
        },
        tmpDir,
      );

      await extract({
        packageName: 'test-delete-meta-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      const markerBefore = readCsvMarker(path.join(outputDir, 'docs', '.publisher'));
      expect(markerBefore.some((m) => m.path === 'file2.md')).toBe(true);

      // Reinstall package with file2 removed
      await installMockPackage('test-delete-meta-package', { 'docs/file1.md': '# File 1' }, tmpDir);

      const result = await extract({
        packageName: 'test-delete-meta-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // file2 should be reported as deleted and removed from disk
      expect(result.deleted).toHaveLength(1);
      expect(result.deleted.some((f) => f.includes('file2.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'docs', 'file2.md'))).toBe(false);

      // metadata must no longer reference file2
      const markerAfter = readCsvMarker(path.join(outputDir, 'docs', '.publisher'));
      expect(markerAfter.some((m) => m.path === 'file2.md')).toBe(false);
      // file1 must still be tracked
      expect(markerAfter.some((m) => m.path === 'file1.md')).toBe(true);
    });

    it('should delete marker files and empty directories when all managed files are removed', async () => {
      const outputDir = path.join(tmpDir, 'output');

      // First extraction: package has all its files inside a subdirectory
      await installMockPackage(
        'test-full-cleanup-package',
        {
          'docs/guide.md': '# Guide',
          'docs/api.md': '# API',
        },
        tmpDir,
      );

      await extract({
        packageName: 'test-full-cleanup-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'docs', '.publisher'))).toBe(true);

      // Reinstall with an empty package (all files removed from the data package)
      await installMockPackage('test-full-cleanup-package', {}, tmpDir);

      const result = await extract({
        packageName: 'test-full-cleanup-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Both files should be deleted
      expect(result.deleted).toHaveLength(2);
      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(false);
      expect(fs.existsSync(path.join(outputDir, 'docs', 'api.md'))).toBe(false);

      // Marker file must be removed because the directory has no managed files left
      expect(fs.existsSync(path.join(outputDir, 'docs', '.publisher'))).toBe(false);

      // Directory itself must be removed because it is now empty
      expect(fs.existsSync(path.join(outputDir, 'docs'))).toBe(false);
    });

    it('should remove marker file but keep directory and unmanaged files when all managed files are deleted', async () => {
      const outputDir = path.join(tmpDir, 'output');

      // First extraction: package places a managed file alongside an unmanaged file
      await installMockPackage(
        'test-unmanaged-coexist-package',
        { 'docs/managed.md': '# Managed' },
        tmpDir,
      );

      await extract({
        packageName: 'test-unmanaged-coexist-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Place an unmanaged file in the same directory
      const unmanagedFile = path.join(outputDir, 'docs', 'unmanaged.md');
      fs.writeFileSync(unmanagedFile, '# Unmanaged');

      expect(fs.existsSync(path.join(outputDir, 'docs', '.publisher'))).toBe(true);

      // Reinstall with an empty package (managed file dropped)
      await installMockPackage('test-unmanaged-coexist-package', {}, tmpDir);

      const result = await extract({
        packageName: 'test-unmanaged-coexist-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Managed file must be deleted
      expect(result.deleted).toHaveLength(1);
      expect(fs.existsSync(path.join(outputDir, 'docs', 'managed.md'))).toBe(false);

      // Marker file must be removed because no managed files remain in this directory
      expect(fs.existsSync(path.join(outputDir, 'docs', '.publisher'))).toBe(false);

      // Unmanaged file and directory must still exist
      expect(fs.existsSync(unmanagedFile)).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'docs'))).toBe(true);
    });

    it('should create .gitignore with managed files and .publisher when gitignore is true', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-gitignore-package',
        {
          'README.md': '# Test',
          'docs/guide.md': '# Guide',
          'docs/api.md': '# API',
        },
        tmpDir,
      );

      await extract({
        packageName: 'test-gitignore-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        gitignore: true,
        filenamePatterns: ['**'],
      });

      // Root .gitignore should contain .publisher and the managed file
      const rootGitignore = fs.readFileSync(path.join(outputDir, '.gitignore'), 'utf8');
      expect(rootGitignore).toContain('.publisher');
      expect(rootGitignore).toContain('README.md');
      expect(rootGitignore).toContain('# folder-publisher:start');
      expect(rootGitignore).toContain('# folder-publisher:end');

      // docs/.gitignore should contain .publisher and both managed docs files
      const docsGitignore = fs.readFileSync(path.join(outputDir, 'docs', '.gitignore'), 'utf8');
      expect(docsGitignore).toContain('.publisher');
      expect(docsGitignore).toContain('guide.md');
      expect(docsGitignore).toContain('api.md');
    });

    it('should not create .gitignore when gitignore option is not set', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('test-no-gitignore-package', { 'README.md': '# Test' }, tmpDir);

      await extract({
        packageName: 'test-no-gitignore-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      expect(fs.existsSync(path.join(outputDir, '.gitignore'))).toBe(false);
    });

    it('should preserve existing .gitignore content when updating managed section', async () => {
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });

      // Pre-create a .gitignore with existing content
      fs.writeFileSync(path.join(outputDir, '.gitignore'), 'node_modules\n*.log\n');

      await installMockPackage('test-gitignore-merge-package', { 'data.json': '{}' }, tmpDir);

      await extract({
        packageName: 'test-gitignore-merge-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        gitignore: true,
      });

      const content = fs.readFileSync(path.join(outputDir, '.gitignore'), 'utf8');
      // Existing content must be preserved
      expect(content).toContain('node_modules');
      expect(content).toContain('*.log');
      // Managed section must be present
      expect(content).toContain('.publisher');
      expect(content).toContain('data.json');
    });

    it('should remove .gitignore managed section when all managed files are deleted', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('test-gitignore-cleanup-package', { 'data.csv': 'a,b' }, tmpDir);

      await extract({
        packageName: 'test-gitignore-cleanup-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['*.csv'],
        gitignore: true,
      });

      expect(fs.existsSync(path.join(outputDir, '.gitignore'))).toBe(true);

      // Reinstall with an empty package (data.csv removed)
      await installMockPackage('test-gitignore-cleanup-package', {}, tmpDir);

      await extract({
        packageName: 'test-gitignore-cleanup-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['*.csv'],
        gitignore: true,
      });

      // .gitignore should be removed since there are no other entries
      expect(fs.existsSync(path.join(outputDir, '.gitignore'))).toBe(false);
    });

    it('should remove only deleted files from .gitignore when some package files are removed', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-partial-delete-package',
        {
          'docs/guide.md': '# Guide',
          'docs/api.md': '# API',
        },
        tmpDir,
      );

      await extract({
        packageName: 'test-partial-delete-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        gitignore: true,
        filenamePatterns: ['**'],
      });

      const before = fs.readFileSync(path.join(outputDir, 'docs', '.gitignore'), 'utf8');
      expect(before).toContain('guide.md');
      expect(before).toContain('api.md');

      // Reinstall package with only one file
      await installMockPackage(
        'test-partial-delete-package',
        { 'docs/guide.md': '# Guide' },
        tmpDir,
      );

      await extract({
        packageName: 'test-partial-delete-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        gitignore: true,
        filenamePatterns: ['**'],
      });

      const after = fs.readFileSync(path.join(outputDir, 'docs', '.gitignore'), 'utf8');
      expect(after).toContain('guide.md');
      expect(after).not.toContain('api.md');
    });

    it('should remove .gitignore entries for deleted files even when gitignore option is not set', async () => {
      const outputDir = path.join(tmpDir, 'output');

      // First extract with gitignore: true to create the .gitignore
      await installMockPackage(
        'test-gitignore-implicit-cleanup-package',
        { 'data.csv': 'a,b', 'other.csv': 'c,d' },
        tmpDir,
      );

      await extract({
        packageName: 'test-gitignore-implicit-cleanup-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        gitignore: true,
        filenamePatterns: ['**'],
      });

      expect(fs.existsSync(path.join(outputDir, '.gitignore'))).toBe(true);
      const before = fs.readFileSync(path.join(outputDir, '.gitignore'), 'utf8');
      expect(before).toContain('data.csv');
      expect(before).toContain('other.csv');

      // Re-extract without gitignore option but with one file removed
      await installMockPackage(
        'test-gitignore-implicit-cleanup-package',
        { 'data.csv': 'a,b' },
        tmpDir,
      );

      await extract({
        packageName: 'test-gitignore-implicit-cleanup-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        // gitignore not set — but deleted files should still be purged from .gitignore
        filenamePatterns: ['**'],
      });

      const after = fs.readFileSync(path.join(outputDir, '.gitignore'), 'utf8');
      expect(after).toContain('data.csv');
      expect(after).not.toContain('other.csv');
    });

    it('should allow two packages to coexist in the same output directory with isolated marker entries', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('pkg-coexist-a', { 'docs/a-guide.md': '# Guide A' }, tmpDir);
      await installMockPackage('pkg-coexist-b', { 'docs/b-guide.md': '# Guide B' }, tmpDir);

      await extract({
        packageName: 'pkg-coexist-a',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });
      await extract({
        packageName: 'pkg-coexist-b',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Both files must be present
      expect(fs.existsSync(path.join(outputDir, 'docs', 'a-guide.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'docs', 'b-guide.md'))).toBe(true);

      // The docs/.publisher marker must carry entries for both packages
      const marker = readCsvMarker(path.join(outputDir, 'docs', '.publisher'));
      expect(marker.some((m) => m.packageName === 'pkg-coexist-a' && m.path === 'a-guide.md')).toBe(
        true,
      );
      expect(marker.some((m) => m.packageName === 'pkg-coexist-b' && m.path === 'b-guide.md')).toBe(
        true,
      );
    });

    it('should not remove files managed by another package when re-extracting', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('pkg-reextract-a', { 'docs/a-file.md': '# A' }, tmpDir);
      await installMockPackage('pkg-reextract-b', { 'docs/b-file.md': '# B' }, tmpDir);

      await extract({
        packageName: 'pkg-reextract-a',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });
      await extract({
        packageName: 'pkg-reextract-b',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Re-extract package-b (no changes to package content)
      const result = await extract({
        packageName: 'pkg-reextract-b',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Package-a's file must not be touched
      expect(result.deleted).not.toContain('docs/a-file.md');
      expect(fs.existsSync(path.join(outputDir, 'docs', 'a-file.md'))).toBe(true);

      // Package-a's marker entry must still be present
      const marker = readCsvMarker(path.join(outputDir, 'docs', '.publisher'));
      expect(
        marker.some((m) => m.packageName === 'pkg-reextract-a' && m.path === 'a-file.md'),
      ).toBe(true);
    });

    it('should only remove the calling package entries from marker when its files are dropped, leaving other package entries intact', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('pkg-drop-a', { 'docs/a-drop.md': '# A' }, tmpDir);
      await installMockPackage('pkg-drop-b', { 'docs/b-keep.md': '# B' }, tmpDir);

      await extract({ packageName: 'pkg-drop-a', outputDir, packageManager: 'pnpm', cwd: tmpDir });
      await extract({ packageName: 'pkg-drop-b', outputDir, packageManager: 'pnpm', cwd: tmpDir });

      // Reinstall package-a with no files (simulates the file being dropped from the package)
      await installMockPackage('pkg-drop-a', {}, tmpDir);

      const result = await extract({
        packageName: 'pkg-drop-a',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Package-a's file must be deleted
      expect(result.deleted).toContain('docs/a-drop.md');
      expect(fs.existsSync(path.join(outputDir, 'docs', 'a-drop.md'))).toBe(false);

      // Package-b's file must still exist
      expect(fs.existsSync(path.join(outputDir, 'docs', 'b-keep.md'))).toBe(true);

      // Marker must only contain package-b's entry
      const marker = readCsvMarker(path.join(outputDir, 'docs', '.publisher'));
      expect(marker.some((m) => m.packageName === 'pkg-drop-a')).toBe(false);
      expect(marker.some((m) => m.packageName === 'pkg-drop-b' && m.path === 'b-keep.md')).toBe(
        true,
      );
    });

    it('should correctly delete a same-named file in a different directory when that directory entry is removed from the package', async () => {
      const outputDir = path.join(tmpDir, 'output');

      // Package has README.md in two different directories
      await installMockPackage(
        'pkg-samename',
        { 'docs/README.md': '# Docs', 'src/README.md': '# Src' },
        tmpDir,
      );

      await extract({
        packageName: 'pkg-samename',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      expect(fs.existsSync(path.join(outputDir, 'docs', 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'src', 'README.md'))).toBe(true);

      // Reinstall package with only docs/README.md (src/README.md dropped)
      await installMockPackage('pkg-samename', { 'docs/README.md': '# Docs' }, tmpDir);

      const result = await extract({
        packageName: 'pkg-samename',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // src/README.md must be deleted even though docs/README.md with the same name still exists
      expect(result.deleted).toContain('src/README.md');
      expect(fs.existsSync(path.join(outputDir, 'src', 'README.md'))).toBe(false);

      // docs/README.md must remain
      expect(fs.existsSync(path.join(outputDir, 'docs', 'README.md'))).toBe(true);
    });
  });

  describe('check', () => {
    it('should fail when package is not installed', async () => {
      await expect(
        check({
          packageName: 'nonexistent-package',
          outputDir: path.join(tmpDir, 'output'),
          cwd: tmpDir,
        }),
      ).rejects.toThrow(`nonexistent-package is not installed`);
    });

    it('should return ok when managed files are in sync', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('test-check-ok-package', { 'docs/guide.md': '# Guide' }, tmpDir);

      await extract({
        packageName: 'test-check-ok-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      const result = await check({
        packageName: 'test-check-ok-package',
        outputDir,
        cwd: tmpDir,
      });

      expect(result.ok).toBe(true);
      expect(result.differences.missing).toHaveLength(0);
      expect(result.differences.modified).toHaveLength(0);
    });

    it('should report missing files when managed files are deleted', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-check-missing-package',
        { 'docs/missing.md': '# Will be deleted' },
        tmpDir,
      );

      await extract({
        packageName: 'test-check-missing-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Delete the extracted file to simulate it going missing
      const extractedFile = path.join(outputDir, 'docs', 'missing.md');
      fs.chmodSync(extractedFile, 0o644);
      fs.unlinkSync(extractedFile);

      const result = await check({
        packageName: 'test-check-missing-package',
        outputDir,
        cwd: tmpDir,
      });

      expect(result.ok).toBe(false);
      expect(result.differences.missing.some((f) => f.includes('missing.md'))).toBe(true);
    });

    it('should report modified files when contents change', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-check-modified-package',
        { 'docs/modified.md': '# Original' },
        tmpDir,
      );

      await extract({
        packageName: 'test-check-modified-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Modify the extracted file
      const extractedFile = path.join(outputDir, 'docs', 'modified.md');
      fs.chmodSync(extractedFile, 0o644);
      fs.writeFileSync(extractedFile, '# Modified content');

      const result = await check({
        packageName: 'test-check-modified-package',
        outputDir,
        cwd: tmpDir,
      });

      expect(result.ok).toBe(false);
      expect(result.differences.modified.some((f) => f.includes('modified.md'))).toBe(true);
    });
  });
});

/**
 * Helper to create a dummy package, create a tar.gz file, and install in pnpm
 */
const installMockPackage = async (
  packageName: string,
  files: Record<string, string>,
  tmpDir: string,
): Promise<string> => {
  const packageDir = path.join(tmpDir, packageName);
  // remove packageDir if it already exists from a previous test run to avoid conflicts
  if (fs.existsSync(packageDir)) {
    fs.rmSync(packageDir, { recursive: true });
  }
  fs.mkdirSync(packageDir, { recursive: true });

  // Create package.json
  const packageJson = {
    name: packageName,
    version: '1.0.0',
  };
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify(packageJson));

  // Create other files
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(packageDir, filePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  // Create tar.gz file
  const tarGzPath = path.join(tmpDir, `${packageName}.tar.gz`);
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(tarGzPath);
    const archive = archiver('tar', { gzip: true });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(packageDir, packageName);
    archive.finalize().catch(reject);
  });

  // Create package.json in tmpDir if it doesn't exist so pnpm recognizes it as a project
  const tmpDirPkgJson = path.join(tmpDir, 'package.json');
  if (!fs.existsSync(tmpDirPkgJson)) {
    fs.writeFileSync(tmpDirPkgJson, JSON.stringify({ name: 'tmp-test-project', version: '1.0.0' }));
  }

  // Install the tar.gz package into tmpDir/node_modules
  execSync(`pnpm add ${tarGzPath}`, {
    cwd: tmpDir,
    stdio: 'pipe',
  });

  return packageDir;
};

describe('installMockPackage', () => {
  // eslint-disable-next-line functional/no-let
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-mock-pkg-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('should return the package source directory path', async () => {
    const packageDir = await installMockPackage('mock-pkg-return', {}, tmpDir);
    expect(packageDir).toBe(path.join(tmpDir, 'mock-pkg-return'));
  });

  it('should install the package into node_modules', async () => {
    await installMockPackage('mock-pkg-install', { 'index.js': 'module.exports = {};' }, tmpDir);

    const installedDir = path.join(tmpDir, 'node_modules', 'mock-pkg-install');
    expect(fs.existsSync(installedDir)).toBe(true);
  });

  it('should have sane contents in node_modules installed package', async () => {
    await installMockPackage(
      'mock-pkg-contents',
      {
        'README.md': '# Mock Package',
        'docs/guide.md': '# Guide',
        'src/index.ts': 'export const value = 42;',
      },
      tmpDir,
    );

    const installedDir = path.join(tmpDir, 'node_modules', 'mock-pkg-contents');

    // package.json should have correct name and version
    const pkgJsonPath = path.join(installedDir, 'package.json');
    expect(fs.existsSync(pkgJsonPath)).toBe(true);
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath).toString());
    expect(pkgJson.name).toBe('mock-pkg-contents');
    expect(pkgJson.version).toBe('1.0.0');

    // all specified files should exist with correct content
    expect(fs.readFileSync(path.join(installedDir, 'README.md'), 'utf8')).toBe('# Mock Package');
    expect(fs.readFileSync(path.join(installedDir, 'docs', 'guide.md'), 'utf8')).toBe('# Guide');
    expect(fs.readFileSync(path.join(installedDir, 'src', 'index.ts'), 'utf8')).toBe(
      'export const value = 42;',
    );
  });

  it('should be discoverable via require.resolve from tmpDir', async () => {
    await installMockPackage('mock-pkg-resolve', { 'index.js': 'module.exports = {};' }, tmpDir);

    const resolvedPath = require.resolve('mock-pkg-resolve/package.json', { paths: [tmpDir] });

    // resolved path must exist on disk
    expect(fs.existsSync(resolvedPath)).toBe(true);

    // package.json contents must be sane
    const pkgJson = JSON.parse(fs.readFileSync(resolvedPath).toString());
    expect(pkgJson.name).toBe('mock-pkg-resolve');
    expect(pkgJson.version).toBe('1.0.0');

    // package directory derived from resolved path must contain the installed files
    const pkgDir = path.dirname(resolvedPath);
    expect(fs.readFileSync(path.join(pkgDir, 'index.js')).toString()).toBe('module.exports = {};');
  });

  it('should produce a module that can be required and executed', async () => {
    await installMockPackage(
      'mock-pkg-usable',
      {
        'index.js':
          'module.exports = { answer: 42, greet: function(name) { return "hello " + name; } };',
      },
      tmpDir,
    );

    const mod = require.resolve('mock-pkg-usable', { paths: [tmpDir] });
    // check module contents
    const pkgDir = path.dirname(mod);
    // eslint-disable-next-line import/no-dynamic-require, global-require, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const requiredModule = require(pkgDir);
    expect(requiredModule.answer).toBe(42);
    expect(requiredModule.greet('world')).toBe('hello world');
  });
});
