import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { minimatch } from 'minimatch';

/**
 * Get hash of file contents
 */
export function calculateFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Check if file contents match regex patterns
 */
export function matchesContentRegex(filePath: string, patterns?: RegExp[]): boolean {
  if (!patterns) return true;
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

  return (
    includes.some((pattern) => minimatch(filename, pattern)) &&
    !excludes.some((pattern) => minimatch(filename, pattern))
  );
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
 * Detect package manager type
 */
export function detectPackageManager(): 'npm' | 'yarn' | 'pnpm' {
  // eslint-disable-next-line functional/no-try-statements
  try {
    const lockFiles = fs.readdirSync('.');
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
