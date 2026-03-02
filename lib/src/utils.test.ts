/* eslint-disable functional/no-try-statements */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  matchesContentRegex,
  findMatchingFiles,
  matchesFilenamePattern,
  calculateFileHash,
  ensureDir,
  removeFile,
  copyFile,
  detectPackageManager,
  getInstalledPackageVersion,
  readJsonFile,
  writeJsonFile,
  parsePackageSpec,
  isBinaryFile,
  readCsvMarker,
  writeCsvMarker,
} from './utils';
import { ManagedFileMetadata } from './types';

describe('Utils', () => {
  // eslint-disable-next-line functional/no-let
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utils-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  describe('matchesFilenamePattern', () => {
    it('should match simple patterns', () => {
      expect(matchesFilenamePattern('test/file.md', ['**/*.md'])).toBe(true);
      expect(matchesFilenamePattern('file.txt', ['*.md'])).toBe(false);
      expect(matchesFilenamePattern('README.md', ['README.md'])).toBe(true);
      // exclude-only pattern, no include: matches everything not excluded
      expect(matchesFilenamePattern('bin/test.js', ['!bin/**'])).toBe(false);
      expect(matchesFilenamePattern('src/index.ts', ['!bin/**'])).toBe(true);
    });

    it('should match multiple patterns', () => {
      expect(matchesFilenamePattern('test/file.md', ['**/*.txt', '**/*.md'])).toBe(true);
      expect(matchesFilenamePattern('./file.js', ['**/*.txt', '**/*.md'])).toBe(false);
      expect(
        matchesFilenamePattern('test1/test2/file.js', ['**/*.js', '**/*.md', '!**/file.js']),
      ).toBe(false);
      expect(matchesFilenamePattern('test/file.js', ['**/*.js', '!**/*.js'])).toBe(false);
      expect(matchesFilenamePattern('bin/file.js', ['**/*.js', '!bin/**'])).toBe(false);
    });

    it('should return true for an empty or exclude-only patterns array', () => {
      // Empty array: behaves like undefined (match all)
      expect(matchesFilenamePattern('anything.txt', [])).toBe(true);
      // Only exclude patterns: match everything not excluded
      expect(matchesFilenamePattern('src/file.ts', ['!bin/**'])).toBe(true);
      expect(matchesFilenamePattern('bin/script.js', ['!bin/**'])).toBe(false);
    });

    it('should return true when patterns is undefined', () => {
      expect(matchesFilenamePattern('anything.txt')).toBe(true);
    });
  });

  describe('matchesContentRegex', () => {
    it('should match content patterns', () => {
      const filePath = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(filePath, 'This is test content');

      expect(matchesContentRegex(filePath, [/test/])).toBe(true);
      expect(matchesContentRegex(filePath, [/notfound/])).toBe(false);
    });

    it('should return true if no regex specified', () => {
      const filePath = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(filePath, 'content');

      expect(matchesContentRegex(filePath)).toBe(true);
    });
  });

  describe('findMatchingFiles', () => {
    it('should find files matching pattern', () => {
      // Create test files
      fs.writeFileSync(path.join(tmpDir, 'file1.md'), 'content');
      fs.writeFileSync(path.join(tmpDir, 'file2.txt'), 'content');
      fs.mkdirSync(path.join(tmpDir, 'subdir'));
      fs.writeFileSync(path.join(tmpDir, 'subdir', 'file3.md'), 'content');

      const files = findMatchingFiles(tmpDir, ['**/*.md']);

      expect(files).toContainEqual(expect.stringContaining('file1.md'));
      expect(files).toContainEqual(expect.stringContaining('file3.md'));
      expect(files).not.toContainEqual(expect.stringContaining('file2.txt'));
    });

    it('should find files matching regex in its contents', () => {
      fs.writeFileSync(path.join(tmpDir, 'file1.txt'), '# Header');
      fs.writeFileSync(path.join(tmpDir, 'file2.txt'), 'No header here');

      const files = findMatchingFiles(tmpDir, ['**/*.txt'], [/#/]);

      expect(files).toContainEqual(expect.stringContaining('file1.txt'));
      expect(files).not.toContainEqual(expect.stringContaining('file2.txt'));
    });
  });

  describe('calculateFileHash', () => {
    it('should return a sha256 hex string for file contents', () => {
      const filePath = path.join(tmpDir, 'hash-test.txt');
      fs.writeFileSync(filePath, 'hello world');

      const hash = calculateFileHash(filePath);
      expect(hash).toMatch(/^[\da-f]{64}$/);
    });

    it('should return same hash for identical file contents', () => {
      const a = path.join(tmpDir, 'a.txt');
      const b = path.join(tmpDir, 'b.txt');
      fs.writeFileSync(a, 'identical content');
      fs.writeFileSync(b, 'identical content');

      expect(calculateFileHash(a)).toBe(calculateFileHash(b));
    });

    it('should return different hash for different file contents', () => {
      const a = path.join(tmpDir, 'a.txt');
      const b = path.join(tmpDir, 'b.txt');
      fs.writeFileSync(a, 'content A');
      fs.writeFileSync(b, 'content B');

      expect(calculateFileHash(a)).not.toBe(calculateFileHash(b));
    });
  });

  describe('ensureDir', () => {
    it('should create directory if it does not exist', () => {
      // eslint-disable-next-line unicorn/no-keyword-prefix
      const newDir = path.join(tmpDir, 'new', 'nested', 'dir');
      expect(fs.existsSync(newDir)).toBe(false);

      ensureDir(newDir);

      expect(fs.existsSync(newDir)).toBe(true);
    });

    it('should not throw if directory already exists', () => {
      expect(() => ensureDir(tmpDir)).not.toThrow();
    });
  });

  describe('removeFile', () => {
    it('should delete a file', () => {
      const filePath = path.join(tmpDir, 'to-remove.txt');
      fs.writeFileSync(filePath, 'content');
      expect(fs.existsSync(filePath)).toBe(true);

      removeFile(filePath);

      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('should delete a read-only file', () => {
      const filePath = path.join(tmpDir, 'readonly.txt');
      fs.writeFileSync(filePath, 'content');
      fs.chmodSync(filePath, 0o444);

      removeFile(filePath);

      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe('copyFile', () => {
    it('should copy a file to a new location', () => {
      const src = path.join(tmpDir, 'source.txt');
      const dest = path.join(tmpDir, 'subdir', 'dest.txt');
      fs.writeFileSync(src, 'copy me');

      copyFile(src, dest);

      expect(fs.existsSync(dest)).toBe(true);
      expect(fs.readFileSync(dest, 'utf8')).toBe('copy me');
    });

    it('should overwrite an existing destination file', () => {
      const src = path.join(tmpDir, 'source.txt');
      const dest = path.join(tmpDir, 'dest.txt');
      fs.writeFileSync(src, 'new content');
      fs.writeFileSync(dest, 'old content');
      fs.chmodSync(dest, 0o444); // read-only, copyFile should handle it

      copyFile(src, dest);

      expect(fs.readFileSync(dest, 'utf8')).toBe('new content');
    });
  });

  describe('detectPackageManager', () => {
    it('should detect pnpm via pnpm-lock.yaml in cwd', () => {
      const origCwd = process.cwd();
      // The lib dir already has pnpm-lock.yaml
      process.chdir(path.join(__dirname, '..'));
      try {
        const pm = detectPackageManager();
        expect(pm).toBe('pnpm');
      } finally {
        process.chdir(origCwd);
      }
    });

    it('should detect yarn via yarn.lock in cwd', () => {
      const yarnLock = path.join(tmpDir, 'yarn.lock');
      fs.writeFileSync(yarnLock, '');
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const pm = detectPackageManager();
        expect(pm).toBe('yarn');
      } finally {
        process.chdir(origCwd);
        fs.unlinkSync(yarnLock);
      }
    });

    it('should detect npm via package-lock.json in cwd', () => {
      const npmLock = path.join(tmpDir, 'package-lock.json');
      fs.writeFileSync(npmLock, '{}');
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const pm = detectPackageManager();
        expect(pm).toBe('npm');
      } finally {
        process.chdir(origCwd);
        fs.unlinkSync(npmLock);
      }
    });

    it('should fall back to npm when no lock file and no user agent', () => {
      // go to an empty dir with no lock files
      const emptyDir = path.join(tmpDir, 'empty');
      fs.mkdirSync(emptyDir);
      const origCwd = process.cwd();
      // eslint-disable-next-line no-process-env
      const origAgent = process.env.npm_config_user_agent;
      process.chdir(emptyDir);
      // eslint-disable-next-line no-process-env, functional/immutable-data
      delete process.env.npm_config_user_agent;
      try {
        const pm = detectPackageManager();
        expect(pm).toBe('npm');
      } finally {
        process.chdir(origCwd);
        if (origAgent) {
          // eslint-disable-next-line no-process-env, functional/immutable-data, camelcase
          process.env.npm_config_user_agent = origAgent;
        }
      }
    });

    it('should detect yarn via npm_config_user_agent when no lock file exists', () => {
      const emptyDir = path.join(tmpDir, 'empty-ua-yarn');
      fs.mkdirSync(emptyDir);
      const origCwd = process.cwd();
      // eslint-disable-next-line no-process-env
      const origAgent = process.env.npm_config_user_agent;
      process.chdir(emptyDir);
      // eslint-disable-next-line no-process-env, functional/immutable-data, camelcase
      process.env.npm_config_user_agent = 'yarn/1.22.0 npm/? node/v16.0.0 linux x64';
      try {
        const pm = detectPackageManager();
        expect(pm).toBe('yarn');
      } finally {
        process.chdir(origCwd);
        if (origAgent) {
          // eslint-disable-next-line no-process-env, functional/immutable-data, camelcase
          process.env.npm_config_user_agent = origAgent;
        } else {
          // eslint-disable-next-line no-process-env, functional/immutable-data, camelcase
          delete process.env.npm_config_user_agent;
        }
      }
    });

    it('should detect pnpm via npm_config_user_agent when no lock file exists', () => {
      const emptyDir = path.join(tmpDir, 'empty-ua-pnpm');
      fs.mkdirSync(emptyDir);
      const origCwd = process.cwd();
      // eslint-disable-next-line no-process-env
      const origAgent = process.env.npm_config_user_agent;
      process.chdir(emptyDir);
      // eslint-disable-next-line no-process-env, functional/immutable-data, camelcase
      process.env.npm_config_user_agent = 'pnpm/8.0.0 npm/? node/v18.0.0 linux x64';
      try {
        const pm = detectPackageManager();
        expect(pm).toBe('pnpm');
      } finally {
        process.chdir(origCwd);
        if (origAgent) {
          // eslint-disable-next-line no-process-env, functional/immutable-data, camelcase
          process.env.npm_config_user_agent = origAgent;
        } else {
          // eslint-disable-next-line no-process-env, functional/immutable-data, camelcase
          delete process.env.npm_config_user_agent;
        }
      }
    });
  });

  describe('getInstalledPackageVersion', () => {
    it('should return null for a non-existent package (no cwd)', () => {
      const version = getInstalledPackageVersion('this-package-does-not-exist-xyz');
      // eslint-disable-next-line unicorn/no-null
      expect(version).toBeNull();
    });

    it('should return null for a non-existent package with cwd', () => {
      const version = getInstalledPackageVersion('nonexistent-package-abc', tmpDir);
      // eslint-disable-next-line unicorn/no-null
      expect(version).toBeNull();
    });

    it('should return version string when package is installed via cwd', () => {
      // Create a fake package in node_modules
      const pkgDir = path.join(tmpDir, 'node_modules', 'my-fake-pkg');
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'my-fake-pkg', version: '3.2.1' }),
      );

      const version = getInstalledPackageVersion('my-fake-pkg', tmpDir);
      expect(version).toBe('3.2.1');
    });

    it('should return version string when package is resolvable without cwd', () => {
      // semver is a dependency of this package so require.resolve can find it without cwd
      const version = getInstalledPackageVersion('semver');
      expect(typeof version).toBe('string');
      expect(version).not.toBeNull();
    });
  });

  describe('readWrite JsonFile', () => {
    it('should read and parse a JSON file', () => {
      const filePath = path.join(tmpDir, 'data.json');
      fs.writeFileSync(filePath, JSON.stringify({ key: 'value', num: 42 }));

      const result = readJsonFile<{ key: string; num: number }>(filePath);
      expect(result.key).toBe('value');
      expect(result.num).toBe(42);
    });

    it('should create parent directories if they do not exist', () => {
      const filePath = path.join(tmpDir, 'nested', 'dir', 'file.json');
      writeJsonFile(filePath, { a: 1 });

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should overwrite an existing read-only file', () => {
      const filePath = path.join(tmpDir, 'existing.json');
      fs.writeFileSync(filePath, JSON.stringify({ old: true }));
      fs.chmodSync(filePath, 0o444);

      writeJsonFile(filePath, { updated: true });

      const result = JSON.parse(fs.readFileSync(filePath).toString());
      expect(result.updated).toBe(true);
    });
  });

  describe('parsePackageSpec', () => {
    it('should parse a plain package name with no version', () => {
      const result = parsePackageSpec('my-pkg');
      expect(result.name).toBe('my-pkg');
      expect(result.version).toBeUndefined();
    });

    it('should parse a package name with semver constraint', () => {
      const result = parsePackageSpec('my-pkg@^1.2.3');
      expect(result.name).toBe('my-pkg');
      expect(result.version).toBe('^1.2.3');
    });

    it('should handle scoped packages with no version', () => {
      const result = parsePackageSpec('@my-org/my-pkg');
      expect(result.name).toBe('@my-org/my-pkg');
      expect(result.version).toBeUndefined();
    });

    it('should handle scoped packages with a version', () => {
      const result = parsePackageSpec('@my-org/my-pkg@2.x');
      expect(result.name).toBe('@my-org/my-pkg');
      expect(result.version).toBe('2.x');
    });

    it('should return undefined version for empty version string', () => {
      // "pkg@" with nothing after the @ - version should be undefined/empty
      const result = parsePackageSpec('my-pkg@');
      expect(result.name).toBe('my-pkg');
      expect(result.version).toBeUndefined();
    });
  });

  describe('isBinaryFile', () => {
    it('should return false for a plain text file', () => {
      const filePath = path.join(tmpDir, 'text.md');
      fs.writeFileSync(filePath, '# Hello World\nThis is text.');
      expect(isBinaryFile(filePath)).toBe(false);
    });

    it('should return true for a file containing null bytes', () => {
      const filePath = path.join(tmpDir, 'binary.bin');
      // eslint-disable-next-line unicorn/number-literal-case
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]);
      fs.writeFileSync(filePath, buf);
      expect(isBinaryFile(filePath)).toBe(true);
    });

    it('should return false for a non-existent file', () => {
      expect(isBinaryFile(path.join(tmpDir, 'does-not-exist.bin'))).toBe(false);
    });
  });

  describe('matchesContentRegex with binary files', () => {
    it('should return false for a binary file even if pattern would match text', () => {
      const filePath = path.join(tmpDir, 'mixed.bin');
      // Create a file that starts with a null byte (binary marker) but also contains text
      const buf = Buffer.concat([Buffer.from([0x00]), Buffer.from('match-this')]);
      fs.writeFileSync(filePath, buf);
      expect(matchesContentRegex(filePath, [/match-this/])).toBe(false);
    });
  });

  describe('detectPackageManager with cwd', () => {
    it('should detect pnpm via pnpm-lock.yaml in given cwd', () => {
      fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
      expect(detectPackageManager(tmpDir)).toBe('pnpm');
    });

    it('should detect yarn via yarn.lock in given cwd', () => {
      fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
      expect(detectPackageManager(tmpDir)).toBe('yarn');
    });

    it('should detect npm via package-lock.json in given cwd', () => {
      fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
      expect(detectPackageManager(tmpDir)).toBe('npm');
    });
  });

  describe('readCsvMarker / writeCsvMarker', () => {
    const sampleData: ManagedFileMetadata[] = [
      { path: 'file.md', packageName: 'my-pkg', packageVersion: '1.0.0', force: false },
      { path: 'docs/guide.md', packageName: 'my-pkg', packageVersion: '1.0.0', force: true },
    ];

    it('should write and read back marker data with pipe delimiter', () => {
      const markerPath = path.join(tmpDir, '.npmdata');
      writeCsvMarker(markerPath, sampleData);

      const content = fs.readFileSync(markerPath, 'utf8');
      // Ensure pipe delimiter is used
      expect(content).toContain('|');
      expect(content).not.toMatch(/file\.md,my-pkg/); // should not use comma as delimiter

      const result = readCsvMarker(markerPath);
      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('file.md');
      expect(result[0].packageName).toBe('my-pkg');
      expect(result[0].force).toBe(false);
      expect(result[1].path).toBe('docs/guide.md');
      expect(result[1].force).toBe(true);
    });

    it('should handle file paths that contain commas (via pipe format)', () => {
      const data: ManagedFileMetadata[] = [
        { path: 'my,file.md', packageName: 'pkg', packageVersion: '1.0.0', force: false },
      ];
      const markerPath = path.join(tmpDir, '.npmdata');
      writeCsvMarker(markerPath, data);

      const result = readCsvMarker(markerPath);
      expect(result[0].path).toBe('my,file.md');
      expect(result[0].packageName).toBe('pkg');
    });

    it('should read legacy comma-delimited marker files for backward compatibility', () => {
      const markerPath = path.join(tmpDir, '.npmdata');
      // Write legacy comma-delimited format without pipe characters
      fs.writeFileSync(markerPath, 'old-file.md,old-pkg,2.0.0,0\n', 'utf8');
      fs.chmodSync(markerPath, 0o444);

      const result = readCsvMarker(markerPath);
      expect(result[0].path).toBe('old-file.md');
      expect(result[0].packageName).toBe('old-pkg');
      expect(result[0].packageVersion).toBe('2.0.0');
      expect(result[0].force).toBe(false);
    });

    it('should make the marker file read-only after writing', () => {
      const markerPath = path.join(tmpDir, '.npmdata');
      writeCsvMarker(markerPath, sampleData);

      const stats = fs.statSync(markerPath);
      // eslint-disable-next-line no-bitwise
      const isWritable = (stats.mode & 0o222) !== 0;
      expect(isWritable).toBe(false);
    });
  });
});
