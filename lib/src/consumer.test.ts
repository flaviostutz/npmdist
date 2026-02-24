/* eslint-disable no-restricted-syntax */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

import archiver from 'archiver';

import { Consumer } from './consumer';
import { FolderPublisherMarker } from './types';
import { readJsonFile } from './utils';

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

  describe('check', () => {
    it('should fail when package is not installed', async () => {
      const consumer = new Consumer({
        packageName: 'nonexistent-package',
        outputDir: path.join(tmpDir, 'output'),
        cwd: tmpDir,
      });
      await expect(consumer.check()).rejects.toThrow(`nonexistent-package is not installed`);
    });
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

      const consumer = new Consumer({
        packageName: 'test-extract-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      // Perform extraction
      await consumer.extract();

      // Verify files were extracted
      expect(fs.existsSync(path.join(outputDir, 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'docs', 'guide.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'src', 'index.ts'))).toBe(true);

      // Verify marker was created
      expect(fs.existsSync(path.join(outputDir, '.folder-publisher'))).toBe(true);

      const rootMarker = readJsonFile<FolderPublisherMarker>(
        path.join(outputDir, '.folder-publisher'),
      );
      expect(rootMarker.managedFiles.some((m) => m.packageName === 'test-extract-package')).toBe(
        true,
      );

      const docsMarker = readJsonFile<FolderPublisherMarker>(
        path.join(outputDir, 'docs', '.folder-publisher'),
      );
      expect(docsMarker.managedFiles[0].packageName).toBe('test-extract-package');

      const srcMarker = readJsonFile<FolderPublisherMarker>(
        path.join(outputDir, 'src', '.folder-publisher'),
      );
      expect(srcMarker.managedFiles[0].packageName).toBe('test-extract-package');
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

      const consumer = new Consumer({
        packageName: 'test-readonly-package',
        outputDir,
        packageManager: 'pnpm',
        cwd: tmpDir,
      });

      await consumer.extract();

      const extractedFile = path.join(outputDir, 'template.md');
      expect(fs.existsSync(extractedFile)).toBe(true);

      const stats = fs.statSync(extractedFile);
      // eslint-disable-next-line no-bitwise
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o444);
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
});
