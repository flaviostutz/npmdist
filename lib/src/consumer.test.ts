/* eslint-disable no-restricted-syntax */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

import archiver from 'archiver';

import { extract, check, list, purge, compressGitignoreEntries } from './consumer';
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
        packages: ['test-extract-package'],
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
      expect(fs.existsSync(path.join(outputDir, '.npmdata'))).toBe(true);

      const rootMarker = readCsvMarker(path.join(outputDir, '.npmdata'));
      expect(rootMarker.some((m) => m.packageName === 'test-extract-package')).toBe(true);
      expect(rootMarker.some((m) => m.path === 'docs/guide.md')).toBe(true);
      expect(rootMarker.some((m) => m.path === 'src/index.ts')).toBe(true);
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
        packages: ['test-readonly-package'],
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

    it('should extract files without .npmdata marker when unmanaged is true', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-unmanaged-package',
        {
          'docs/guide.md': '# Guide',
          'README.md': '# Package',
        },
        tmpDir,
      );

      await extract({
        packages: ['test-unmanaged-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        unmanaged: true,
        filenamePatterns: ['**'],
      });

      expect(fs.existsSync(path.join(outputDir, 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);

      // No .npmdata marker files should be created
      expect(fs.existsSync(path.join(outputDir, '.npmdata'))).toBe(false);
      expect(fs.existsSync(path.join(outputDir, 'docs', '.npmdata'))).toBe(false);
    });

    it('should not make files read-only when unmanaged is true', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-unmanaged-writable-package',
        { 'template.md': '# Template' },
        tmpDir,
      );

      await extract({
        packages: ['test-unmanaged-writable-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        unmanaged: true,
      });

      const extractedFile = path.join(outputDir, 'template.md');
      expect(fs.existsSync(extractedFile)).toBe(true);

      const stats = fs.statSync(extractedFile);
      // File should have write permission (i.e., not be strictly 0o444 read-only)
      // eslint-disable-next-line no-bitwise
      expect(stats.mode & 0o200).toBeGreaterThan(0);
    });

    it('should skip existing files when unmanaged is true', async () => {
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });

      const originalContent = 'original user content';
      fs.writeFileSync(path.join(outputDir, 'guide.md'), originalContent);

      await installMockPackage(
        'test-unmanaged-skip-package',
        { 'guide.md': '# Package version' },
        tmpDir,
      );

      const result = await extract({
        packages: ['test-unmanaged-skip-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        unmanaged: true,
      });

      // Existing file must not be overwritten
      expect(fs.readFileSync(path.join(outputDir, 'guide.md'), 'utf8')).toBe(originalContent);

      // File should be reported as skipped
      expect(result.skipped).toContain('guide.md');
      expect(result.modified).not.toContain('guide.md');
      expect(result.added).not.toContain('guide.md');
    });

    it('should not update .gitignore when unmanaged is true', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('test-unmanaged-gitignore-package', { 'data.json': '{}' }, tmpDir);

      await extract({
        packages: ['test-unmanaged-gitignore-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        unmanaged: true,
        gitignore: true,
      });

      // No .gitignore should be created even with gitignore: true
      expect(fs.existsSync(path.join(outputDir, '.gitignore'))).toBe(false);
    });

    it('should update managed files on second extraction of the same package', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('test-update-package', { 'docs/guide.md': '# Guide v1' }, tmpDir);

      await extract({
        packages: ['test-update-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Re-install same package (simulate update) and extract again
      await extract({
        packages: ['test-update-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);
    });

    it('should be idempotent when package has dotfile directory paths', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-dotfile-idempotent-package',
        {
          'AGENTS.md': '# AGENTS',
          '.xdrs/_general/adrs/index.md': '# Index',
          '.xdrs/_general/adrs/principles/001-xdr-standards.md': '# Standards',
        },
        tmpDir,
      );

      // First extraction with patterns that include dotfiles
      const firstResult = await extract({
        packages: ['test-dotfile-idempotent-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['.**/**', '**'],
      });

      expect(firstResult.added).toContain('.xdrs/_general/adrs/index.md');
      expect(firstResult.added).toContain('.xdrs/_general/adrs/principles/001-xdr-standards.md');
      expect(fs.existsSync(path.join(outputDir, '.xdrs/_general/adrs/index.md'))).toBe(true);
      expect(
        fs.existsSync(path.join(outputDir, '.xdrs/_general/adrs/principles/001-xdr-standards.md')),
      ).toBe(true);

      // Second extraction must not throw "File conflict" and must skip all files
      const secondResult = await extract({
        packages: ['test-dotfile-idempotent-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['.**/**', '**'],
      });

      expect(secondResult.added).toHaveLength(0);
      expect(secondResult.modified).toHaveLength(0);
      expect(secondResult.deleted).toHaveLength(0);
      expect(secondResult.skipped).toContain('.xdrs/_general/adrs/index.md');
      expect(secondResult.skipped).toContain('.xdrs/_general/adrs/principles/001-xdr-standards.md');
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
        packages: ['test-idempotent-package'],
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
        packages: ['test-idempotent-package'],
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

    it('should throw on file conflict with unmanaged existing file when force is false', async () => {
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });

      const originalContent = 'existing unmanaged content';
      fs.writeFileSync(path.join(outputDir, 'config.md'), originalContent);

      await installMockPackage(
        'test-conflict-no-force-package',
        { 'config.md': '# Config from package' },
        tmpDir,
      );

      await expect(
        extract({
          packages: ['test-conflict-no-force-package'],
          outputDir,
          packageManager: 'pnpm',
          cwd: tmpDir,
          force: false,
        }),
      ).rejects.toThrow('File conflict');

      // File content must be untouched
      expect(fs.readFileSync(path.join(outputDir, 'config.md'), 'utf8')).toBe(originalContent);

      // No marker file must have been created
      expect(fs.existsSync(path.join(outputDir, '.npmdata'))).toBe(false);
    });

    it('should overwrite unmanaged file and track it in the marker when force is true', async () => {
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });

      fs.writeFileSync(path.join(outputDir, 'overwrite.md'), 'pre-existing unmanaged content');

      await installMockPackage(
        'test-conflict-force-package',
        { 'overwrite.md': '# Content from package' },
        tmpDir,
      );

      const result = await extract({
        packages: ['test-conflict-force-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        force: true,
      });

      // File must contain the package content
      expect(fs.readFileSync(path.join(outputDir, 'overwrite.md'), 'utf8')).toBe(
        '# Content from package',
      );

      // Result must report it as modified (overwrote an existing file)
      expect(result.modified).toContain('overwrite.md');
      expect(result.added).not.toContain('overwrite.md');

      // Marker must record the file as owned by this package
      const marker = readCsvMarker(path.join(outputDir, '.npmdata'));
      expect(
        marker.some(
          (m) => m.packageName === 'test-conflict-force-package' && m.path === 'overwrite.md',
        ),
      ).toBe(true);
    });

    it('should create missing files when keepExisting is true', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-keep-existing-new-package',
        { 'new-file.md': '# From package' },
        tmpDir,
      );

      const result = await extract({
        packages: ['test-keep-existing-new-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        keepExisting: true,
        filenamePatterns: ['**'],
      });

      // Missing file should be created
      expect(fs.existsSync(path.join(outputDir, 'new-file.md'))).toBe(true);
      expect(fs.readFileSync(path.join(outputDir, 'new-file.md'), 'utf8')).toBe('# From package');
      expect(result.added).toContain('new-file.md');
    });

    it('should skip existing files when keepExisting is true without overwriting', async () => {
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });

      const userContent = 'user-modified content';
      fs.writeFileSync(path.join(outputDir, 'existing.md'), userContent);

      await installMockPackage(
        'test-keep-existing-skip-package',
        { 'existing.md': '# From package' },
        tmpDir,
      );

      const result = await extract({
        packages: ['test-keep-existing-skip-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        keepExisting: true,
        filenamePatterns: ['**'],
      });

      // Existing file must NOT be overwritten
      expect(fs.readFileSync(path.join(outputDir, 'existing.md'), 'utf8')).toBe(userContent);
      expect(result.skipped).toContain('existing.md');
      expect(result.modified).not.toContain('existing.md');
      expect(result.added).not.toContain('existing.md');
    });

    it('should throw when force and keepExisting are both true', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-force-keep-conflict-package',
        { 'file.md': '# content' },
        tmpDir,
      );

      await expect(
        extract({
          packages: ['test-force-keep-conflict-package'],
          outputDir,
          packageManager: 'pnpm',
          cwd: tmpDir,
          force: true,
          keepExisting: true,
        }),
      ).rejects.toThrow('force and keepExisting cannot be used together');
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
        packages: ['test-filter-package'],
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
        packages: ['test-delete-meta-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      const markerBefore = readCsvMarker(path.join(outputDir, '.npmdata'));
      expect(markerBefore.some((m) => m.path === 'docs/file2.md')).toBe(true);

      // Reinstall package with file2 removed
      await installMockPackage('test-delete-meta-package', { 'docs/file1.md': '# File 1' }, tmpDir);

      const result = await extract({
        packages: ['test-delete-meta-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // file2 should be reported as deleted and removed from disk
      expect(result.deleted).toHaveLength(1);
      expect(result.deleted.some((f) => f.includes('file2.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'docs', 'file2.md'))).toBe(false);

      // metadata must no longer reference file2
      const markerAfter = readCsvMarker(path.join(outputDir, '.npmdata'));
      expect(markerAfter.some((m) => m.path === 'docs/file2.md')).toBe(false);
      // file1 must still be tracked
      expect(markerAfter.some((m) => m.path === 'docs/file1.md')).toBe(true);
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
        packages: ['test-full-cleanup-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, '.npmdata'))).toBe(true);

      // Reinstall with an empty package (all files removed from the data package)
      await installMockPackage('test-full-cleanup-package', {}, tmpDir);

      const result = await extract({
        packages: ['test-full-cleanup-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Both files should be deleted
      expect(result.deleted).toHaveLength(2);
      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(false);
      expect(fs.existsSync(path.join(outputDir, 'docs', 'api.md'))).toBe(false);

      // Root marker must be removed because there are no managed files left
      expect(fs.existsSync(path.join(outputDir, '.npmdata'))).toBe(false);

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
        packages: ['test-unmanaged-coexist-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Place an unmanaged file in the same directory
      const unmanagedFile = path.join(outputDir, 'docs', 'unmanaged.md');
      fs.writeFileSync(unmanagedFile, '# Unmanaged');

      expect(fs.existsSync(path.join(outputDir, '.npmdata'))).toBe(true);

      // Reinstall with an empty package (managed file dropped)
      await installMockPackage('test-unmanaged-coexist-package', {}, tmpDir);

      const result = await extract({
        packages: ['test-unmanaged-coexist-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Managed file must be deleted
      expect(result.deleted).toHaveLength(1);
      expect(fs.existsSync(path.join(outputDir, 'docs', 'managed.md'))).toBe(false);

      // Root marker must be removed because no managed files remain
      expect(fs.existsSync(path.join(outputDir, '.npmdata'))).toBe(false);

      // Unmanaged file and directory must still exist
      expect(fs.existsSync(unmanagedFile)).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'docs'))).toBe(true);
    });

    it('should create .gitignore with managed files and .npmdata when gitignore is true', async () => {
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
        packages: ['test-gitignore-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        gitignore: true,
        filenamePatterns: ['**'],
      });

      // Root .gitignore should contain .npmdata and the root-level README.md;
      // docs/ is fully managed so it appears as a directory pattern, not individual files.
      const rootGitignore = fs.readFileSync(path.join(outputDir, '.gitignore'), 'utf8');
      expect(rootGitignore).toContain('.npmdata');
      expect(rootGitignore).toContain('README.md');
      expect(rootGitignore).toContain('docs/');
      expect(rootGitignore).not.toContain('docs/guide.md');
      expect(rootGitignore).not.toContain('docs/api.md');
      expect(rootGitignore).toContain('# npmdata:start');
      expect(rootGitignore).toContain('# npmdata:end');

      // docs/ must NOT have its own .gitignore (consolidated to root)
      expect(fs.existsSync(path.join(outputDir, 'docs', '.gitignore'))).toBe(false);
    });

    it('should not create .gitignore when gitignore option is false', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('test-no-gitignore-package', { 'README.md': '# Test' }, tmpDir);

      await extract({
        packages: ['test-no-gitignore-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        gitignore: false,
      });

      expect(fs.existsSync(path.join(outputDir, '.gitignore'))).toBe(false);
    });

    it('should create .gitignore by default when gitignore option is not specified', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('test-default-gitignore-package', { 'data.json': '{}' }, tmpDir);

      await extract({
        packages: ['test-default-gitignore-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      const gitignorePath = path.join(outputDir, '.gitignore');
      expect(fs.existsSync(gitignorePath)).toBe(true);
      const content = fs.readFileSync(gitignorePath, 'utf8');
      expect(content).toContain('.npmdata');
      expect(content).toContain('data.json');
      expect(content).toContain('# npmdata:start');
      expect(content).toContain('# npmdata:end');
    });

    it('should preserve existing .gitignore content when updating managed section', async () => {
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });

      // Pre-create a .gitignore with existing content
      fs.writeFileSync(path.join(outputDir, '.gitignore'), 'node_modules\n*.log\n');

      await installMockPackage('test-gitignore-merge-package', { 'data.json': '{}' }, tmpDir);

      await extract({
        packages: ['test-gitignore-merge-package'],
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
      expect(content).toContain('.npmdata');
      expect(content).toContain('data.json');
    });

    it('should remove .gitignore managed section when all managed files are deleted', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('test-gitignore-cleanup-package', { 'data.csv': 'a,b' }, tmpDir);

      await extract({
        packages: ['test-gitignore-cleanup-package'],
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
        packages: ['test-gitignore-cleanup-package'],
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
        packages: ['test-partial-delete-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        gitignore: true,
        filenamePatterns: ['**'],
      });

      // Both docs files are managed → entire docs/ dir is compressed to a single pattern
      const before = fs.readFileSync(path.join(outputDir, '.gitignore'), 'utf8');
      expect(before).toContain('docs/');
      expect(before).not.toContain('docs/guide.md');
      expect(before).not.toContain('docs/api.md');

      // Reinstall package with only one file
      await installMockPackage(
        'test-partial-delete-package',
        { 'docs/guide.md': '# Guide' },
        tmpDir,
      );

      await extract({
        packages: ['test-partial-delete-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        gitignore: true,
        filenamePatterns: ['**'],
      });

      // docs/ still has only the managed guide.md → still compressed to docs/
      const after = fs.readFileSync(path.join(outputDir, '.gitignore'), 'utf8');
      expect(after).toContain('docs/');
      expect(after).not.toContain('docs/api.md');
    });

    it('should list individual files in .gitignore when a directory has unmanaged files alongside managed ones', async () => {
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });

      // Place an unmanaged file in docs/ before extraction
      fs.writeFileSync(path.join(outputDir, 'docs', 'unmanaged.md'), '# Unmanaged');

      await installMockPackage(
        'test-partial-dir-gitignore-package',
        { 'docs/guide.md': '# Guide', 'docs/api.md': '# API' },
        tmpDir,
      );

      await extract({
        packages: ['test-partial-dir-gitignore-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        gitignore: true,
        filenamePatterns: ['**'],
      });

      const gitignore = fs.readFileSync(path.join(outputDir, '.gitignore'), 'utf8');
      // docs/ contains an unmanaged file — cannot be collapsed to a directory pattern
      expect(gitignore).not.toMatch(/^docs\/$/m);
      expect(gitignore).toContain('docs/guide.md');
      expect(gitignore).toContain('docs/api.md');
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
        packages: ['test-gitignore-implicit-cleanup-package'],
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
        packages: ['test-gitignore-implicit-cleanup-package'],
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
        packages: ['pkg-coexist-a'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });
      await extract({
        packages: ['pkg-coexist-b'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Both files must be present
      expect(fs.existsSync(path.join(outputDir, 'docs', 'a-guide.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'docs', 'b-guide.md'))).toBe(true);

      // The root .npmdata marker must carry entries for both packages with full relPaths
      const marker = readCsvMarker(path.join(outputDir, '.npmdata'));
      expect(
        marker.some((m) => m.packageName === 'pkg-coexist-a' && m.path === 'docs/a-guide.md'),
      ).toBe(true);
      expect(
        marker.some((m) => m.packageName === 'pkg-coexist-b' && m.path === 'docs/b-guide.md'),
      ).toBe(true);
    });

    it('should not remove files managed by another package when re-extracting', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('pkg-reextract-a', { 'docs/a-file.md': '# A' }, tmpDir);
      await installMockPackage('pkg-reextract-b', { 'docs/b-file.md': '# B' }, tmpDir);

      await extract({
        packages: ['pkg-reextract-a'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });
      await extract({
        packages: ['pkg-reextract-b'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Re-extract package-b (no changes to package content)
      const result = await extract({
        packages: ['pkg-reextract-b'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Package-a's file must not be touched
      expect(result.deleted).not.toContain('docs/a-file.md');
      expect(fs.existsSync(path.join(outputDir, 'docs', 'a-file.md'))).toBe(true);

      // Package-a's marker entry must still be present
      const marker = readCsvMarker(path.join(outputDir, '.npmdata'));
      expect(
        marker.some((m) => m.packageName === 'pkg-reextract-a' && m.path === 'docs/a-file.md'),
      ).toBe(true);
    });

    it('should only remove the calling package entries from marker when its files are dropped, leaving other package entries intact', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('pkg-drop-a', { 'docs/a-drop.md': '# A' }, tmpDir);
      await installMockPackage('pkg-drop-b', { 'docs/b-keep.md': '# B' }, tmpDir);

      await extract({ packages: ['pkg-drop-a'], outputDir, packageManager: 'pnpm', cwd: tmpDir });
      await extract({ packages: ['pkg-drop-b'], outputDir, packageManager: 'pnpm', cwd: tmpDir });

      // Reinstall package-a with no files (simulates the file being dropped from the package)
      await installMockPackage('pkg-drop-a', {}, tmpDir);

      const result = await extract({
        packages: ['pkg-drop-a'],
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
      const marker = readCsvMarker(path.join(outputDir, '.npmdata'));
      expect(marker.some((m) => m.packageName === 'pkg-drop-a')).toBe(false);
      expect(
        marker.some((m) => m.packageName === 'pkg-drop-b' && m.path === 'docs/b-keep.md'),
      ).toBe(true);
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
        packages: ['pkg-samename'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      expect(fs.existsSync(path.join(outputDir, 'docs', 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'src', 'README.md'))).toBe(true);

      // Reinstall package with only docs/README.md (src/README.md dropped)
      await installMockPackage('pkg-samename', { 'docs/README.md': '# Docs' }, tmpDir);

      const result = await extract({
        packages: ['pkg-samename'],
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

    it('should throw a package clash error when a file is already managed by a different package', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('pkg-clash-a', { 'docs/shared.md': '# Shared by A' }, tmpDir);
      await installMockPackage('pkg-clash-b', { 'docs/shared.md': '# Shared by B' }, tmpDir);

      await extract({
        packages: ['pkg-clash-a'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      await expect(
        extract({
          packages: ['pkg-clash-b'],
          outputDir,
          packageManager: 'pnpm',
          cwd: tmpDir,
        }),
      ).rejects.toThrow('Package clash');
    });

    it('should transfer ownership when force is true and file is managed by a different package', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'pkg-force-owner-a',
        { 'docs/shared.md': '# Content from A' },
        tmpDir,
      );
      await installMockPackage(
        'pkg-force-owner-b',
        { 'docs/shared.md': '# Content from B' },
        tmpDir,
      );

      // First extraction: pkg-force-owner-a owns docs/shared.md
      await extract({
        packages: ['pkg-force-owner-a'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      const markerBefore = readCsvMarker(path.join(outputDir, '.npmdata'));
      expect(markerBefore.some((m) => m.packageName === 'pkg-force-owner-a')).toBe(true);

      // Second extraction with force: pkg-force-owner-b should take ownership
      const result = await extract({
        packages: ['pkg-force-owner-b'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        force: true,
      });

      // File content must come from the new owner
      const content = fs.readFileSync(path.join(outputDir, 'docs', 'shared.md'), 'utf8');
      expect(content).toBe('# Content from B');

      // Result must report the file as modified (ownership transferred, content overwritten)
      expect(result.modified).toContain('docs/shared.md');

      // Marker must show pkg-force-owner-b as the sole owner; pkg-force-owner-a evicted
      const markerAfter = readCsvMarker(path.join(outputDir, '.npmdata'));
      expect(markerAfter.some((m) => m.packageName === 'pkg-force-owner-b')).toBe(true);
      expect(markerAfter.some((m) => m.packageName === 'pkg-force-owner-a')).toBe(false);
    });

    it('should not overwrite a file managed by a different package when force is false', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('pkg-no-force-a', { 'data/record.json': '{"owner":"a"}' }, tmpDir);
      await installMockPackage('pkg-no-force-b', { 'data/record.json': '{"owner":"b"}' }, tmpDir);

      // Establish ownership with pkg-no-force-a
      await extract({
        packages: ['pkg-no-force-a'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // pkg-no-force-b must not be able to claim the file without force
      await expect(
        extract({
          packages: ['pkg-no-force-b'],
          outputDir,
          packageManager: 'pnpm',
          cwd: tmpDir,
          force: false,
        }),
      ).rejects.toThrow('Package clash');

      // File content and ownership must be unchanged
      const content = fs.readFileSync(path.join(outputDir, 'data', 'record.json'), 'utf8');
      expect(content).toBe('{"owner":"a"}');

      const marker = readCsvMarker(path.join(outputDir, '.npmdata'));
      expect(
        marker.some((m) => m.packageName === 'pkg-no-force-a' && m.path === 'data/record.json'),
      ).toBe(true);
      expect(marker.some((m) => m.packageName === 'pkg-no-force-b')).toBe(false);
    });

    it('should throw when installed package version does not satisfy the requested version constraint', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('pkg-version-check', { 'file.md': '# File' }, tmpDir);

      await expect(
        extract({
          packages: ['pkg-version-check@>=99.0.0'],
          outputDir,
          packageManager: 'pnpm',
          cwd: tmpDir,
        }),
      ).rejects.toThrow('does not match constraint');
    });

    it('should extract successfully when package name has no version indication', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('pkg-no-version-spec', { 'docs/guide.md': '# Guide' }, tmpDir);

      const result = await extract({
        packages: ['pkg-no-version-spec'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);
      expect(result.added).toContain('docs/guide.md');

      // Marker must record the bare package name (no version suffix) with full relPath
      const marker = readCsvMarker(path.join(outputDir, '.npmdata'));
      expect(
        marker.some((m) => m.packageName === 'pkg-no-version-spec' && m.path === 'docs/guide.md'),
      ).toBe(true);
    });

    it('should extract successfully when package name includes a satisfied version constraint', async () => {
      const outputDir = path.join(tmpDir, 'output');

      // installMockPackage installs version 1.0.0 by default
      await installMockPackage('pkg-with-version-spec', { 'docs/guide.md': '# Guide' }, tmpDir);

      const result = await extract({
        packages: ['pkg-with-version-spec@>=1.0.0'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);
      expect(result.added).toContain('docs/guide.md');

      // Marker must record the bare package name (not the full spec) with full relPath
      const marker = readCsvMarker(path.join(outputDir, '.npmdata'));
      expect(
        marker.some((m) => m.packageName === 'pkg-with-version-spec' && m.path === 'docs/guide.md'),
      ).toBe(true);
    });

    it('should report modified files when package content changes on re-extraction', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('pkg-content-change', { 'docs/note.md': '# Version 1' }, tmpDir);

      await extract({
        packages: ['pkg-content-change'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Reinstall with different content
      await installMockPackage('pkg-content-change', { 'docs/note.md': '# Version 2' }, tmpDir);

      const result = await extract({
        packages: ['pkg-content-change'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      expect(result.modified).toContain('docs/note.md');
      expect(result.added).toHaveLength(0);
      const content = fs.readFileSync(path.join(outputDir, 'docs', 'note.md'), 'utf8');
      expect(content).toBe('# Version 2');
    });

    it('should preserve non-npmdata content in .gitignore when removing the managed section', async () => {
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });

      // Pre-populate .gitignore with content outside the npmdata section
      fs.writeFileSync(path.join(outputDir, '.gitignore'), 'node_modules\nbuild/\n');

      await installMockPackage('pkg-gitignore-preserve', { 'data.csv': 'a,b' }, tmpDir);

      await extract({
        packages: ['pkg-gitignore-preserve'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        gitignore: true,
        filenamePatterns: ['*.csv'],
      });

      // Verify the section was added
      const before = fs.readFileSync(path.join(outputDir, '.gitignore'), 'utf8');
      expect(before).toContain('node_modules');
      expect(before).toContain('data.csv');

      // Reinstall with empty package so the managed section gets removed
      await installMockPackage('pkg-gitignore-preserve', {}, tmpDir);

      await extract({
        packages: ['pkg-gitignore-preserve'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        gitignore: true,
        filenamePatterns: ['*.csv'],
      });

      // .gitignore should still exist (non-npmdata content remains) but without the managed section
      expect(fs.existsSync(path.join(outputDir, '.gitignore'))).toBe(true);
      const after = fs.readFileSync(path.join(outputDir, '.gitignore'), 'utf8');
      expect(after).toContain('node_modules');
      expect(after).not.toContain('data.csv');
      expect(after).not.toContain('# npmdata:start');
    });

    it('should clean up orphaned npmdata section in a subdirectory .gitignore when that dir has no marker', async () => {
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });

      // Create a subdirectory containing an orphaned .gitignore (no .npmdata marker)
      const orphanDir = path.join(outputDir, 'orphan-subdir');
      fs.mkdirSync(orphanDir, { recursive: true });
      const gitignoreContent = '# npmdata:start\n.npmdata\norphan.md\n# npmdata:end\n';
      fs.writeFileSync(path.join(orphanDir, '.gitignore'), gitignoreContent);

      // Extract a package whose file goes into outputDir root (not into orphan-subdir)
      await installMockPackage('pkg-orphan-gitignore', { 'root-file.md': '# Root' }, tmpDir);

      // Extract without gitignore option: only cleanup runs, no new entries are added
      await extract({
        packages: ['pkg-orphan-gitignore'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // The orphaned npmdata section should have been removed from orphan-subdir/.gitignore
      // (the file may be deleted entirely if it had no other content)
      const orphanGitignorePath = path.join(orphanDir, '.gitignore');
      const orphanGitignoreExists = fs.existsSync(orphanGitignorePath);
      const orphanGitignoreContent = orphanGitignoreExists
        ? fs.readFileSync(orphanGitignorePath, 'utf8')
        : '';
      expect(orphanGitignoreContent).not.toContain('# npmdata:start');
    });

    it('should clean up empty marker files left by prior operations', async () => {
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });

      // Manually create an empty .npmdata marker file
      const markerPath = path.join(outputDir, '.npmdata');
      fs.writeFileSync(markerPath, '\n');

      await installMockPackage('pkg-empty-marker', { 'file.md': '# File' }, tmpDir);

      // extract will call cleanupEmptyMarkers which should remove the empty marker
      await extract({
        packages: ['pkg-empty-marker'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // The root .npmdata marker is now valid (has entries for pkg-empty-marker)
      const marker = readCsvMarker(path.join(outputDir, '.npmdata'));
      expect(marker.some((m) => m.packageName === 'pkg-empty-marker')).toBe(true);
    });

    it('should not write any files to disk when a later package fails the pre-flight check', async () => {
      const outputDir = path.join(tmpDir, 'output');

      // First package is valid and installed
      await installMockPackage('pkg-preflight-ok', { 'docs/first.md': '# First' }, tmpDir);
      // Second package is installed at 1.0.0 but we request >=99.0.0, which will fail
      await installMockPackage('pkg-preflight-bad', { 'docs/second.md': '# Second' }, tmpDir);

      await expect(
        extract({
          packages: ['pkg-preflight-ok', 'pkg-preflight-bad@>=99.0.0'],
          outputDir,
          packageManager: 'pnpm',
          cwd: tmpDir,
        }),
      ).rejects.toThrow('does not match constraint');

      // No files from either package should have been written
      expect(fs.existsSync(path.join(outputDir, 'docs', 'first.md'))).toBe(false);
      expect(fs.existsSync(path.join(outputDir, 'docs', 'second.md'))).toBe(false);
    });

    it('should not remove directories that contain a symlink during empty-dir cleanup', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-symlink-cleanup-package',
        { 'docs/guide.md': '# Guide' },
        tmpDir,
      );

      await extract({
        packages: ['test-symlink-cleanup-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);

      // Place a symlink inside the docs/ directory
      const symlinkTarget = path.join(tmpDir, 'external-target.txt');
      fs.writeFileSync(symlinkTarget, 'external content');
      const symlinkPath = path.join(outputDir, 'docs', 'link.txt');
      fs.symlinkSync(symlinkTarget, symlinkPath);

      // Reinstall with an empty package so all managed files are deleted, triggering cleanupEmptyDirs
      await installMockPackage('test-symlink-cleanup-package', {}, tmpDir);

      await extract({
        packages: ['test-symlink-cleanup-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Managed file must be gone
      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(false);

      // Directory must NOT be removed because the symlink makes it non-empty
      expect(fs.existsSync(path.join(outputDir, 'docs'))).toBe(true);
      expect(fs.lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
    });

    it('should not extract symlink files found inside an installed package', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-symlink-pkg-file',
        { 'docs/guide.md': '# Guide', 'README.md': '# Readme' },
        tmpDir,
      );

      // Inject a symlink directly into the installed package directory
      const installedPkgDir = path.join(tmpDir, 'node_modules', 'test-symlink-pkg-file');
      const symlinkTarget = path.join(tmpDir, 'external-target.txt');
      fs.writeFileSync(symlinkTarget, 'external content');
      fs.symlinkSync(symlinkTarget, path.join(installedPkgDir, 'docs', 'link.txt'));

      const result = await extract({
        packages: ['test-symlink-pkg-file'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**'],
      });

      // Real files should be extracted
      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'README.md'))).toBe(true);

      // The symlink must NOT have been extracted
      expect(fs.existsSync(path.join(outputDir, 'docs', 'link.txt'))).toBe(false);
      expect(result.added).not.toContain('docs/link.txt');
    });

    it('should not follow symlinked directories in the output dir when loading managed files', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('test-symlink-output-walk', { 'docs/guide.md': '# Guide' }, tmpDir);

      await extract({
        packages: ['test-symlink-output-walk'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Add a symlink to an external directory inside the output dir
      const externalDir = path.join(tmpDir, 'external-dir');
      fs.mkdirSync(externalDir, { recursive: true });
      fs.writeFileSync(path.join(externalDir, 'secret.md'), '# Secret');
      // Also put a .npmdata marker there to detect if it gets accidentally walked
      fs.writeFileSync(
        path.join(externalDir, '.npmdata'),
        'path,packageName,packageVersion,force\n',
      );
      fs.symlinkSync(externalDir, path.join(outputDir, 'symlinked-dir'));

      // list() uses loadAllManagedFiles — must not descend into the symlinked directory
      const listed = list(outputDir);
      const allPaths = listed.flatMap((e) => e.files);
      expect(allPaths).not.toContain('symlinked-dir/secret.md');

      // check() uses getPackageFiles and loadAllManagedFiles — must complete without error
      // and must not report the symlinked file as extra
      const checkResult = await check({
        packages: ['test-symlink-output-walk'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });
      expect(checkResult.ok).toBe(true);
    });

    it('should not follow symlinked directories in the output dir during cleanup passes', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('test-symlink-cleanup-walk', { 'data/file.md': '# File' }, tmpDir);

      await extract({
        packages: ['test-symlink-cleanup-walk'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Add a symlink pointing to a directory containing its own .npmdata marker
      const externalDir = path.join(tmpDir, 'external-cleanup-dir');
      fs.mkdirSync(externalDir, { recursive: true });
      fs.writeFileSync(path.join(externalDir, 'extra.md'), '# Extra');

      const symlinkDir = path.join(outputDir, 'linked');
      fs.symlinkSync(externalDir, symlinkDir);

      // purge triggers cleanupEmptyMarkers and updateGitignores — must not crash or follow symlink
      const purgeResult = await purge({
        packages: ['test-symlink-cleanup-walk'],
        outputDir,
      });

      expect(purgeResult.deleted).toContain('data/file.md');

      // Symlink must still be intact (not deleted, not followed)
      expect(fs.lstatSync(symlinkDir).isSymbolicLink()).toBe(true);
    });

    it('should delete created files on extraction error', async () => {
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });

      // Package has two files: 'new-file.md' (new) and 'conflict.md' (conflicts with existing).
      // Files in a package directory are read in filesystem order, so we name them so that
      // 'new-file.md' sorts before 'conflict.md' — but the conflict file already exists on
      // disk, which triggers an error. The 'new-file.md' created before the error must be
      // rolled back.
      await installMockPackage(
        'test-cleanup-on-error-package',
        {
          'aaa-created.md': '# Created before conflict',
          'zzz-conflict.md': '# From package',
        },
        tmpDir,
      );

      // Place an unmanaged file that will clash with 'zzz-conflict.md'
      fs.writeFileSync(path.join(outputDir, 'zzz-conflict.md'), 'existing unmanaged content');

      await expect(
        extract({
          packages: ['test-cleanup-on-error-package'],
          outputDir,
          packageManager: 'pnpm',
          cwd: tmpDir,
          filenamePatterns: ['**'],
          force: false,
        }),
      ).rejects.toThrow('File conflict');

      // 'aaa-created.md' must have been deleted as part of rollback
      expect(fs.existsSync(path.join(outputDir, 'aaa-created.md'))).toBe(false);

      // Pre-existing conflicting file must remain untouched
      expect(fs.readFileSync(path.join(outputDir, 'zzz-conflict.md'), 'utf8')).toBe(
        'existing unmanaged content',
      );

      // No marker file must have been created
      expect(fs.existsSync(path.join(outputDir, '.npmdata'))).toBe(false);
    });
  });

  describe('check', () => {
    it('should fail when package is not installed', async () => {
      await expect(
        check({
          packages: ['nonexistent-package'],
          outputDir: path.join(tmpDir, 'output'),
          cwd: tmpDir,
        }),
      ).rejects.toThrow(`nonexistent-package is not installed`);
    });

    it('should return ok when managed files are in sync', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('test-check-ok-package', { 'docs/guide.md': '# Guide' }, tmpDir);

      await extract({
        packages: ['test-check-ok-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      const result = await check({
        packages: ['test-check-ok-package'],
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
        packages: ['test-check-missing-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Delete the extracted file to simulate it going missing
      const extractedFile = path.join(outputDir, 'docs', 'missing.md');
      fs.chmodSync(extractedFile, 0o644);
      fs.unlinkSync(extractedFile);

      const result = await check({
        packages: ['test-check-missing-package'],
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
        packages: ['test-check-modified-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Modify the extracted file
      const extractedFile = path.join(outputDir, 'docs', 'modified.md');
      fs.chmodSync(extractedFile, 0o644);
      fs.writeFileSync(extractedFile, '# Modified content');

      const result = await check({
        packages: ['test-check-modified-package'],
        outputDir,
        cwd: tmpDir,
      });

      expect(result.ok).toBe(false);
      expect(result.differences.modified.some((f) => f.includes('modified.md'))).toBe(true);
    });

    it('should include per-package ok flag and differences in result', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('test-check-per-pkg', { 'info.md': '# Info' }, tmpDir);

      await extract({
        packages: ['test-check-per-pkg'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      const result = await check({
        packages: ['test-check-per-pkg'],
        outputDir,
        cwd: tmpDir,
      });

      expect(result.sourcePackages).toHaveLength(1);
      expect(result.sourcePackages[0].name).toBe('test-check-per-pkg');
      expect(result.sourcePackages[0].ok).toBe(true);
      expect(result.sourcePackages[0].differences.missing).toHaveLength(0);
      expect(result.sourcePackages[0].differences.modified).toHaveLength(0);
      expect(result.sourcePackages[0].differences.extra).toHaveLength(0);
    });

    it('should report extra files from package that were never extracted', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-check-extra-package',
        {
          'docs/existing.md': '# Existing',
          'docs/new-in-pkg.md': '# New file added to package',
        },
        tmpDir,
      );

      // Extract only docs/existing.md by using a filter
      await extract({
        packages: ['test-check-extra-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**/existing.md'],
      });

      // Now check without the filter — the package has docs/new-in-pkg.md which was never extracted
      const result = await check({
        packages: ['test-check-extra-package'],
        outputDir,
        cwd: tmpDir,
      });

      expect(result.ok).toBe(false);
      expect(result.differences.extra.some((f) => f.includes('new-in-pkg.md'))).toBe(true);
    });

    it('should throw when installed version does not satisfy constraint', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage('test-check-constraint-pkg', { 'data.md': '# Data' }, tmpDir);

      await extract({
        packages: ['test-check-constraint-pkg'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Check with a constraint that version 1.0.0 does NOT satisfy
      await expect(
        check({
          packages: ['test-check-constraint-pkg@^2.0.0'],
          outputDir,
          cwd: tmpDir,
        }),
      ).rejects.toThrow(/does not satisfy constraint/);
    });

    it('should report in sync when contentReplacements are applied to extracted files', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-check-replacement-sync',
        { 'docs/guide.md': '# Guide\n<!-- version: 0.0.0 -->\n' },
        tmpDir,
      );

      await extract({
        packages: ['test-check-replacement-sync'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**'],
      });

      // Simulate the post-extract content replacement modifying the file in-place
      const extractedFile = path.join(outputDir, 'docs', 'guide.md');
      fs.chmodSync(extractedFile, 0o644);
      fs.writeFileSync(extractedFile, '# Guide\n<!-- version: 1.2.3 -->\n', 'utf8');
      fs.chmodSync(extractedFile, 0o444);

      const replacement = {
        files: `${path.relative(tmpDir, outputDir)}/**/*.md`,
        match: '<!-- version: .* -->',
        replace: '<!-- version: 1.2.3 -->',
      };

      // check() without replacements should report the file as modified
      const resultWithout = await check({
        packages: ['test-check-replacement-sync'],
        outputDir,
        cwd: tmpDir,
      });
      expect(resultWithout.ok).toBe(false);
      expect(resultWithout.differences.modified.some((f) => f.includes('guide.md'))).toBe(true);

      // check() WITH the replacement config should report in sync
      const resultWith = await check({
        packages: ['test-check-replacement-sync'],
        outputDir,
        cwd: tmpDir,
        contentReplacements: [replacement],
      });
      expect(resultWith.ok).toBe(true);
      expect(resultWith.differences.modified).toHaveLength(0);
    });

    it('should still detect genuinely modified files when contentReplacements are provided', async () => {
      const outputDir = path.join(tmpDir, 'output');

      await installMockPackage(
        'test-check-replacement-still-modified',
        { 'config.json': '{"key":"original"}' },
        tmpDir,
      );

      await extract({
        packages: ['test-check-replacement-still-modified'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**'],
      });

      // User modified the file manually (not via a declared replacement)
      const extractedFile = path.join(outputDir, 'config.json');
      fs.chmodSync(extractedFile, 0o644);
      fs.writeFileSync(extractedFile, '{"key":"tampered"}', 'utf8');
      fs.chmodSync(extractedFile, 0o444);

      // Providing a replacement for a different file pattern should not mask the real change
      const result = await check({
        packages: ['test-check-replacement-still-modified'],
        outputDir,
        cwd: tmpDir,
        contentReplacements: [{ files: '**/*.md', match: 'anything', replace: 'anything' }],
      });

      expect(result.ok).toBe(false);
      expect(result.differences.modified.some((f) => f.includes('config.json'))).toBe(true);
    });
  });

  describe('extract dry-run', () => {
    it('should not write any files when dryRun is true', async () => {
      const outputDir = path.join(tmpDir, 'dry-output');

      await installMockPackage(
        'test-dryrun-package',
        { 'docs/guide.md': '# Guide', 'README.md': '# Readme' },
        tmpDir,
      );

      const result = await extract({
        packages: ['test-dryrun-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        dryRun: true,
      });

      // Output directory should not be created
      expect(fs.existsSync(outputDir)).toBe(false);
      // Result should still report what WOULD have been added
      expect(result.added.length).toBeGreaterThan(0);
      expect(result.modified).toHaveLength(0);
      expect(result.deleted).toHaveLength(0);
    });

    it('should not write marker files when dryRun is true', async () => {
      const outputDir = path.join(tmpDir, 'dry-output-marker');
      fs.mkdirSync(outputDir, { recursive: true });

      await installMockPackage('test-dryrun-marker-package', { 'data.md': '# Data' }, tmpDir);

      await extract({
        packages: ['test-dryrun-marker-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        dryRun: true,
      });

      expect(fs.existsSync(path.join(outputDir, '.npmdata'))).toBe(false);
    });

    it('should report correct counts in dry-run result', async () => {
      const outputDir = path.join(tmpDir, 'dry-output-counts');

      await installMockPackage(
        'test-dryrun-counts-package',
        { 'a.md': '# A', 'b.md': '# B' },
        tmpDir,
      );

      const result = await extract({
        packages: ['test-dryrun-counts-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        dryRun: true,
        filenamePatterns: ['**'],
      });

      // 2 files would be added (package.json is filtered by DEFAULT_FILENAME_PATTERNS)
      expect(result.sourcePackages[0].changes.added.length).toBeGreaterThan(0);
      expect(result.sourcePackages[0].changes.modified).toHaveLength(0);
    });
  });

  describe('extract onProgress', () => {
    it('should call onProgress for each added file', async () => {
      const outputDir = path.join(tmpDir, 'progress-output');
      const events: string[] = [];

      await installMockPackage('test-progress-package', { 'docs/guide.md': '# Guide' }, tmpDir);

      await extract({
        packages: ['test-progress-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        onProgress: (evt) => {
          // eslint-disable-next-line functional/immutable-data
          events.push(evt.type);
        },
      });

      expect(events).toContain('package-start');
      expect(events).toContain('file-added');
      expect(events).toContain('package-end');
    });

    it('should call onProgress with file-skipped for unchanged files on re-extraction', async () => {
      const outputDir = path.join(tmpDir, 'progress-skip-output');

      await installMockPackage('test-progress-skip-package', { 'config.md': '# Config' }, tmpDir);

      await extract({
        packages: ['test-progress-skip-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      const skippedEvents: string[] = [];
      await extract({
        packages: ['test-progress-skip-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        onProgress: (evt) => {
          if (evt.type === 'file-skipped') {
            // eslint-disable-next-line functional/immutable-data
            skippedEvents.push(evt.file);
          }
        },
      });

      expect(skippedEvents.some((f) => f.includes('config.md'))).toBe(true);
    });
  });

  describe('list', () => {
    it('should return packages and files managed in outputDir', async () => {
      const outputDir = path.join(tmpDir, 'list-output');

      await installMockPackage(
        'test-list-package',
        { 'docs/guide.md': '# Guide', 'README.md': '# Readme' },
        tmpDir,
      );

      await extract({
        packages: ['test-list-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**'],
      });

      const results = list(outputDir);
      expect(results.length).toBeGreaterThan(0);
      const entry = results.find((r) => r.packageName === 'test-list-package');
      expect(entry).toBeDefined();
      expect(entry!.files.some((f) => f.includes('guide.md'))).toBe(true);
    });

    it('should return empty array for a directory with no managed files', () => {
      const emptyDir = path.join(tmpDir, 'empty-list-output');
      fs.mkdirSync(emptyDir, { recursive: true });

      const results = list(emptyDir);
      expect(results).toHaveLength(0);
    });

    it('should return empty array for a non-existent directory', () => {
      const results = list(path.join(tmpDir, 'nonexistent'));
      expect(results).toHaveLength(0);
    });

    it('should group files by package', async () => {
      const outputDir = path.join(tmpDir, 'list-multi-pkg-output');

      await installMockPackage('list-pkg-a', { 'a/file-a.md': '# A' }, tmpDir);
      await installMockPackage('list-pkg-b', { 'b/file-b.md': '# B' }, tmpDir);

      await extract({
        packages: ['list-pkg-a', 'list-pkg-b'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**/*.md'],
      });

      const results = list(outputDir);
      const packageNames = results.map((r) => r.packageName);
      expect(packageNames).toContain('list-pkg-a');
      expect(packageNames).toContain('list-pkg-b');
    });
  });
  describe('purge', () => {
    it('should delete all managed files for the given package', async () => {
      const outputDir = path.join(tmpDir, 'purge-output');

      await installMockPackage(
        'test-purge-package',
        { 'docs/guide.md': '# Guide', 'data/file.json': '{}' },
        tmpDir,
      );

      await extract({
        packages: ['test-purge-package'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**'],
      });

      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'data', 'file.json'))).toBe(true);

      const result = await purge({
        packages: ['test-purge-package'],
        outputDir,
      });

      expect(result.deleted).toContain('docs/guide.md');
      expect(result.deleted).toContain('data/file.json');
      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(false);
      expect(fs.existsSync(path.join(outputDir, 'data', 'file.json'))).toBe(false);
    });

    it('should remove the package entry from .npmdata marker files', async () => {
      const outputDir = path.join(tmpDir, 'purge-marker-output');

      await installMockPackage('test-purge-marker', { 'docs/guide.md': '# Guide' }, tmpDir);

      await extract({
        packages: ['test-purge-marker'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**'],
      });

      await purge({ packages: ['test-purge-marker'], outputDir });

      // root .npmdata marker must be removed when no managed files remain
      expect(fs.existsSync(path.join(outputDir, '.npmdata'))).toBe(false);
    });

    it('should keep managed files belonging to other packages', async () => {
      const outputDir = path.join(tmpDir, 'purge-other-output');

      await installMockPackage('test-purge-pkg-a', { 'a/file-a.txt': 'A content' }, tmpDir);
      await installMockPackage('test-purge-pkg-b', { 'b/file-b.txt': 'B content' }, tmpDir);

      await extract({
        packages: ['test-purge-pkg-a', 'test-purge-pkg-b'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['a/**', 'b/**'],
      });

      expect(fs.existsSync(path.join(outputDir, 'a', 'file-a.txt'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'b', 'file-b.txt'))).toBe(true);

      await purge({ packages: ['test-purge-pkg-a'], outputDir });

      // pkg-a files deleted, pkg-b files preserved
      expect(fs.existsSync(path.join(outputDir, 'a', 'file-a.txt'))).toBe(false);
      expect(fs.existsSync(path.join(outputDir, 'b', 'file-b.txt'))).toBe(true);
    });

    it('should simulate deletion without touching disk when dryRun is true', async () => {
      const outputDir = path.join(tmpDir, 'purge-dryrun-output');

      await installMockPackage('test-purge-dryrun', { 'docs/note.md': '# Note' }, tmpDir);

      await extract({
        packages: ['test-purge-dryrun'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**'],
      });

      const result = await purge({
        packages: ['test-purge-dryrun'],
        outputDir,
        dryRun: true,
      });

      // result reflects what would have been deleted
      expect(result.deleted).toContain('docs/note.md');
      // file still exists because dryRun=true
      expect(fs.existsSync(path.join(outputDir, 'docs', 'note.md'))).toBe(true);
    });

    it('should return empty result when no files are managed by the package', async () => {
      const outputDir = path.join(tmpDir, 'purge-empty-output');
      fs.mkdirSync(outputDir, { recursive: true });

      const result = await purge({
        packages: ['nonexistent-package'],
        outputDir,
      });

      expect(result.deleted).toHaveLength(0);
    });

    it('should emit file-deleted progress events', async () => {
      const outputDir = path.join(tmpDir, 'purge-progress-output');

      await installMockPackage('test-purge-progress', { 'docs/page.md': '# Page' }, tmpDir);

      await extract({
        packages: ['test-purge-progress'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**'],
      });

      const progressMock = jest.fn();
      await purge({
        packages: ['test-purge-progress'],
        outputDir,
        onProgress: progressMock,
      });

      const deletedFiles = progressMock.mock.calls
        .filter(([e]) => e.type === 'file-deleted')
        .map(([e]) => e.file);
      expect(deletedFiles).toContain('docs/page.md');
    });

    it('should clean up empty directories after purge', async () => {
      const outputDir = path.join(tmpDir, 'purge-dirs-output');

      await installMockPackage('test-purge-dirs', { 'docs/sub/file.md': '# File' }, tmpDir);

      await extract({
        packages: ['test-purge-dirs'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**'],
      });

      await purge({ packages: ['test-purge-dirs'], outputDir });

      // Empty subdirectories should be removed
      expect(fs.existsSync(path.join(outputDir, 'docs', 'sub'))).toBe(false);
      expect(fs.existsSync(path.join(outputDir, 'docs'))).toBe(false);
    });

    it('should accept package spec with version constraint and use the name only', async () => {
      const outputDir = path.join(tmpDir, 'purge-spec-output');

      await installMockPackage('test-purge-spec', { 'config.json': '{}' }, tmpDir);

      await extract({
        packages: ['test-purge-spec'],
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
        filenamePatterns: ['**'],
      });

      // Pass spec with version; purge should resolve the name and delete the files.
      const result = await purge({
        packages: ['test-purge-spec@^1.0.0'],
        outputDir,
      });

      expect(result.deleted).toContain('config.json');
      expect(fs.existsSync(path.join(outputDir, 'config.json'))).toBe(false);
    });
  });
}); // end describe('Consumer')

describe('compressGitignoreEntries', () => {
  // eslint-disable-next-line functional/no-let
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-gitignore-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('should return root-level files unchanged', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# readme');
    fs.writeFileSync(path.join(tmpDir, 'data.json'), '{}');
    const result = compressGitignoreEntries(['README.md', 'data.json'], tmpDir);
    expect(result).toContain('README.md');
    expect(result).toContain('data.json');
  });

  it('should collapse a fully-managed directory to dir/', () => {
    fs.mkdirSync(path.join(tmpDir, 'docs'));
    fs.writeFileSync(path.join(tmpDir, 'docs', 'guide.md'), '# guide');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'api.md'), '# api');
    const result = compressGitignoreEntries(['docs/guide.md', 'docs/api.md'], tmpDir);
    expect(result).toContain('docs/');
    expect(result).not.toContain('docs/guide.md');
    expect(result).not.toContain('docs/api.md');
  });

  it('should not collapse a directory that has unmanaged files on disk', () => {
    fs.mkdirSync(path.join(tmpDir, 'docs'));
    fs.writeFileSync(path.join(tmpDir, 'docs', 'guide.md'), '# guide');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'api.md'), '# api');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'manual.md'), '# unmanaged');
    const result = compressGitignoreEntries(['docs/guide.md', 'docs/api.md'], tmpDir);
    expect(result).not.toContain('docs/');
    expect(result).toContain('docs/guide.md');
    expect(result).toContain('docs/api.md');
  });

  it('should collapse only the fully-managed subdirectory, not the parent', () => {
    fs.mkdirSync(path.join(tmpDir, 'src', 'utils'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'src', 'extra.ts'), ''); // unmanaged
    fs.writeFileSync(path.join(tmpDir, 'src', 'utils', 'helper.ts'), '');
    const result = compressGitignoreEntries(['src/main.ts', 'src/utils/helper.ts'], tmpDir);
    expect(result).not.toContain('src/');
    expect(result).toContain('src/main.ts');
    expect(result).toContain('src/utils/');
    expect(result).not.toContain('src/utils/helper.ts');
  });

  it('should ignore MARKER_FILE and GITIGNORE_FILE when assessing full coverage', () => {
    fs.mkdirSync(path.join(tmpDir, 'docs'));
    fs.writeFileSync(path.join(tmpDir, 'docs', 'guide.md'), '# guide');
    fs.writeFileSync(path.join(tmpDir, 'docs', '.npmdata'), 'guide.md|pkg|1.0.0|0');
    fs.writeFileSync(
      path.join(tmpDir, 'docs', '.gitignore'),
      '# npmdata:start\n.npmdata\nguide.md\n# npmdata:end\n',
    );
    const result = compressGitignoreEntries(['docs/guide.md'], tmpDir);
    expect(result).toContain('docs/');
    expect(result).not.toContain('docs/guide.md');
  });

  it('should return an empty array for empty input', () => {
    const result = compressGitignoreEntries([], tmpDir);
    expect(result).toHaveLength(0);
  });

  it('should collapse nested directories when all their contents are managed', () => {
    fs.mkdirSync(path.join(tmpDir, 'a', 'b', 'c'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'a', 'b', 'c', 'file.md'), '');
    const result = compressGitignoreEntries(['a/b/c/file.md'], tmpDir);
    expect(result).toContain('a/');
    expect(result).not.toContain('a/b/');
    expect(result).not.toContain('a/b/c/');
  });
});

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
