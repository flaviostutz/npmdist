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
} from './utils';

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
      expect(matchesFilenamePattern('bin/test.js', ['!bin'])).toBe(false);
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

    it('should return false if no pattern specified', () => {
      expect(matchesFilenamePattern('anything.txt', [])).toBe(false);
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
});
