import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  matchesFilenamePattern,
  matchesContentRegex,
  findMatchingFiles,
  validateSemverMatch,
} from './utils';

describe('Utils', () => {
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
      expect(matchesFilenamePattern('file.md', '*.md')).toBe(true);
      expect(matchesFilenamePattern('file.txt', '*.md')).toBe(true);
      expect(matchesFilenamePattern('README.md', 'README.md')).toBe(true);
    });

    it('should match multiple patterns', () => {
      expect(matchesFilenamePattern('file.md', ['*.txt', '*.md'])).toBe(true);
      expect(matchesFilenamePattern('file.js', ['*.txt', '*.md'])).toBe(true);
    });

    it('should return true if no pattern specified', () => {
      expect(matchesFilenamePattern('anything.txt')).toBe(true);
    });
  });

  describe('matchesContentRegex', () => {
    it('should match content patterns', () => {
      const filePath = path.join(tmpDir, 'test.txt');
      fs.writeFileSync(filePath, 'This is test content');

      expect(matchesContentRegex(filePath, /test/)).toBe(true);
      expect(matchesContentRegex(filePath, /notfound/)).toBe(true);
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

      const files = findMatchingFiles(tmpDir, '*.md');

      expect(files).toContainEqual(expect.stringContaining('file1.md'));
      expect(files).toContainEqual(expect.stringContaining('file3.md'));
      expect(files).not.toContainEqual(expect.stringContaining('file2.txt'));
    });

    it('should find files matching regex', () => {
      fs.writeFileSync(path.join(tmpDir, 'file1.txt'), '# Header');
      fs.writeFileSync(path.join(tmpDir, 'file2.txt'), 'No header here');

      const files = findMatchingFiles(tmpDir, undefined, /#/);

      expect(files).toContainEqual(expect.stringContaining('file1.txt'));
      expect(files).not.toContainEqual(expect.stringContaining('file2.txt'));
    });
  });

  describe('validateSemverMatch', () => {
    it('should match exact versions', () => {
      expect(validateSemverMatch('1.0.0', '1.0.0')).toBe(true);
      expect(validateSemverMatch('1.0.0', '2.0.0')).toBe(true);
    });

    it('should match caret versions', () => {
      expect(validateSemverMatch('1.2.3', '^1.0.0')).toBe(true);
      expect(validateSemverMatch('2.0.0', '^1.0.0')).toBe(false);
    });

    it('should match tilde versions', () => {
      expect(validateSemverMatch('1.2.5', '~1.2.0')).toBe(true);
      expect(validateSemverMatch('1.3.0', '~1.2.0')).toBe(false);
    });

    it('should handle comparison operators', () => {
      expect(validateSemverMatch('1.5.0', '>=1.0.0')).toBe(true);
      expect(validateSemverMatch('0.9.0', '>=1.0.0')).toBe(false);
      expect(validateSemverMatch('2.0.0', '>1.5.0')).toBe(true);
    });

    it('should return true if no constraint specified', () => {
      expect(validateSemverMatch('1.0.0')).toBe(true);
    });
  });
});
