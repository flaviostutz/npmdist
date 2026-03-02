import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { minimatch } from 'minimatch';

import { ManagedFileMetadata } from './types';

/**
 * Parse a package spec like "my-pkg@^1.2.3" or "@scope/pkg@2.x" into name and version.
 * The version separator is the LAST "@" so that scoped packages ("@scope/name") are handled correctly.
 */
export function parsePackageSpec(spec: string): { name: string; version: string | undefined } {
  const atIdx = spec.lastIndexOf('@');
  if (atIdx > 0) {
    // eslint-disable-next-line no-undefined
    return { name: spec.slice(0, atIdx), version: spec.slice(atIdx + 1) || undefined };
  }
  // eslint-disable-next-line no-undefined
  return { name: spec, version: undefined };
}

/**
 * Detect whether a file is binary by scanning it for null bytes.
 * Reads up to the first 8 KB only to keep memory usage low.
 */
export function isBinaryFile(filePath: string): boolean {
  // eslint-disable-next-line functional/no-try-statements
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);
    return buf.slice(0, bytesRead).includes(0x00);
  } catch {
    return false;
  }
}

/**
 * Get hash of file contents
 */
export function calculateFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Check if file contents match regex patterns.
 * Binary files (detected via null-byte scan) are always excluded when patterns are set.
 */
export function matchesContentRegex(filePath: string, patterns?: RegExp[]): boolean {
  if (!patterns) return true;
  if (isBinaryFile(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf8');
  return patterns.some((pattern) => pattern.test(content));
}

/**
 * Recursively find all files in directory matching filters
 */
export function findMatchingFiles(
  dir: string,
  filenamePatterns?: string[],
  contentRegexes?: RegExp[],
): string[] {
  const results: string[] = [];

  function walkDir(currentDir: string): void {
    const files = fs.readdirSync(currentDir);

    // eslint-disable-next-line no-restricted-syntax
    for (const file of files) {
      const fullPath = path.join(currentDir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        walkDir(fullPath);
        // eslint-disable-next-line no-continue
        continue;
      }

      if (
        // Check if file matches include patterns and does not match exclude patterns, and matches content regex
        matchesFilenamePattern(fullPath, filenamePatterns) &&
        matchesContentRegex(fullPath, contentRegexes)
      ) {
        // eslint-disable-next-line functional/immutable-data
        results.push(fullPath);
      }
    }
  }

  walkDir(dir);
  return results;
}

export const matchesFilenamePattern = (filename: string, patterns?: string[]): boolean => {
  if (!patterns) return true;

  // Separate include and exclude patterns (exclude patterns start with '!')
  const includes = patterns.filter((p) => !p.startsWith('!'));
  const excludes = patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1));

  // When there are no positive include patterns, treat as "match all" (same as undefined).
  // This avoids the footgun where an empty array silently excludes every file.
  const matchesIncludes =
    includes.length === 0 || includes.some((pattern) => minimatch(filename, pattern));

  return matchesIncludes && !excludes.some((pattern) => minimatch(filename, pattern));
};

/**
 * Create directory recursively
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Remove file with error handling
 */
export function removeFile(filePath: string): void {
  fs.chmodSync(filePath, 0o644); // Make writable before deleting
  fs.unlinkSync(filePath);
}

/**
 * Copy file preserving directory structure
 */
export function copyFile(src: string, dest: string): void {
  ensureDir(path.dirname(dest));
  // Make destination writable if it exists (e.g., from previous extraction)
  if (fs.existsSync(dest)) {
    fs.chmodSync(dest, 0o644);
  }
  fs.copyFileSync(src, dest);
}

/**
 * Detect package manager type.
 * Inspects the lock files in the given directory (defaults to process.cwd()).
 */
export function detectPackageManager(cwd?: string): 'npm' | 'yarn' | 'pnpm' {
  const dir = cwd ?? '.';
  // eslint-disable-next-line functional/no-try-statements
  try {
    const lockFiles = fs.readdirSync(dir);
    if (lockFiles.includes('pnpm-lock.yaml')) return 'pnpm';
    if (lockFiles.includes('yarn.lock')) return 'yarn';
    if (lockFiles.includes('package-lock.json')) return 'npm';
  } catch {
    // Continue to env check
  }

  // Check npm_config_user_agent environment variable
  // eslint-disable-next-line no-process-env
  const userAgent = process.env.npm_config_user_agent || '';
  if (userAgent.includes('yarn')) return 'yarn';
  if (userAgent.includes('pnpm')) return 'pnpm';

  return 'npm'; // Default fallback
}

/**
 * Get package info from installed package
 */
export function getInstalledPackageVersion(packageName: string, cwd?: string): string | null {
  // eslint-disable-next-line functional/no-try-statements
  try {
    if (cwd) {
      const pkgPath = path.join(cwd, 'node_modules', packageName, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath).toString());
      return pkg.version;
    }
    const pkgPath = require.resolve(`${packageName}/package.json`);
    const pkg = JSON.parse(fs.readFileSync(pkgPath).toString());
    return pkg.version;
  } catch {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }
}

/**
 * Read JSON file safely
 */
export function readJsonFile<T>(filePath: string): T {
  const content = fs.readFileSync(filePath).toString();
  return JSON.parse(content);
}

/**
 * Write JSON file
 */
export function writeJsonFile(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  // Make file writable if it exists (e.g., marker file from previous extraction)
  if (fs.existsSync(filePath)) {
    fs.chmodSync(filePath, 0o644);
  }
  // eslint-disable-next-line unicorn/no-null
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

const MARKER_DELIMITER = '|';

/**
 * Read the .npmdata marker file.
 * Supports both the current pipe-delimited format and the legacy comma-delimited format
 * (detected automatically for backward compatibility).
 */
export function readCsvMarker(filePath: string): ManagedFileMetadata[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter((line) => line.trim() !== '');
  return lines.map((line) => {
    // Detect format: new records use '|'; legacy records use ','
    const delimiter = line.includes(MARKER_DELIMITER) ? MARKER_DELIMITER : ',';
    const fields = line.split(delimiter);
    return {
      path: fields[0],
      packageName: fields[1],
      packageVersion: fields[2],
      force: fields[3] === '1',
    };
  });
}

/**
 * Write the .npmdata marker file using the pipe-delimited format.
 */
export function writeCsvMarker(filePath: string, data: ManagedFileMetadata[]): void {
  ensureDir(path.dirname(filePath));
  if (fs.existsSync(filePath)) {
    fs.chmodSync(filePath, 0o644);
  }
  const rows = data.map((m) =>
    [m.path, m.packageName, m.packageVersion, m.force ? '1' : '0'].join(MARKER_DELIMITER),
  );
  fs.writeFileSync(filePath, `${rows.join('\n')}\n`, 'utf8');
  fs.chmodSync(filePath, 0o444);
}
