/* eslint-disable functional/no-try-statements */
/* eslint-disable functional/no-let */
/* eslint-disable no-continue */
/* eslint-disable functional/immutable-data */
/* eslint-disable no-restricted-syntax */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { satisfies } from 'semver';

import {
  ConsumerConfig,
  ConsumerResult,
  CheckResult,
  ManagedFileMetadata,
  DEFAULT_FILENAME_PATTERNS,
} from './types';
import {
  ensureDir,
  removeFile,
  copyFile,
  calculateFileHash,
  matchesFilenamePattern,
  matchesContentRegex,
  detectPackageManager,
  getInstalledPackageVersion,
  readCsvMarker,
  writeCsvMarker,
} from './utils';

const MARKER_FILE = '.publisher';
const GITIGNORE_FILE = '.gitignore';
const GITIGNORE_START = '# folder-publisher:start';
const GITIGNORE_END = '# folder-publisher:end';

/**
 * Update (or create) a .gitignore in the given directory so that the managed
 * files and the .publisher marker file are ignored by git.
 * If managedFilenames is empty the folder-publisher section is removed; if the
 * resulting file is empty it is deleted.
 * When addEntries is false, only existing sections are updated/removed — no new
 * section is written if one did not already exist.
 */
function updateGitignoreForDir(dir: string, managedFilenames: string[], addEntries = true): void {
  const gitignorePath = path.join(dir, GITIGNORE_FILE);

  let existingContent = '';
  if (fs.existsSync(gitignorePath)) {
    existingContent = fs.readFileSync(gitignorePath, 'utf8');
  }

  const startIdx = existingContent.indexOf(GITIGNORE_START);
  const endIdx = existingContent.indexOf(GITIGNORE_END);
  const hasExistingSection = startIdx !== -1 && endIdx !== -1 && startIdx < endIdx;

  // When not adding entries and there is no existing section, there is nothing to clean up.
  if (!addEntries && !hasExistingSection) return;

  let beforeSection = existingContent;
  let afterSection = '';

  if (hasExistingSection) {
    beforeSection = existingContent.slice(0, startIdx).trimEnd();
    afterSection = existingContent.slice(endIdx + GITIGNORE_END.length).trimStart();
  }

  if (managedFilenames.length === 0) {
    // Remove the managed section entirely.
    const updatedContent = [beforeSection, afterSection].filter(Boolean).join('\n');
    if (updatedContent.trim()) {
      fs.writeFileSync(gitignorePath, `${updatedContent.trimEnd()}\n`, 'utf8');
    } else if (fs.existsSync(gitignorePath)) {
      fs.unlinkSync(gitignorePath);
    }
    return;
  }

  // When addEntries is false, only update an existing section (stale entries removed);
  // if there is no existing section do not create one (already returned above).
  const section = [GITIGNORE_START, MARKER_FILE, ...managedFilenames.sort(), GITIGNORE_END].join(
    '\n',
  );

  const parts = [beforeSection, section, afterSection].filter(Boolean);
  const updatedContent = `${parts.join('\n')}\n`;
  fs.writeFileSync(gitignorePath, updatedContent, 'utf8');
}

/**
 * Walk outputDir and update .gitignore files for every directory that has a
 * .publisher marker (to reflect its current managed files) and also clean up
 * any folder-publisher sections in directories where the marker was removed.
 * When addEntries is false, existing sections are updated/removed but no new
 * sections are created — use this to clean up without opting into gitignore management.
 */
function updateGitignores(outputDir: string, addEntries = true): void {
  if (!fs.existsSync(outputDir)) return;

  const walkDir = (dir: string): void => {
    const markerPath = path.join(dir, MARKER_FILE);
    const gitignorePath = path.join(dir, GITIGNORE_FILE);

    if (fs.existsSync(markerPath)) {
      try {
        const managedFiles = readCsvMarker(markerPath);
        updateGitignoreForDir(
          dir,
          managedFiles.map((m) => m.path),
          addEntries,
        );
      } catch {
        // Ignore unreadable marker files
      }
    } else if (fs.existsSync(gitignorePath)) {
      // Clean up any leftover folder-publisher section
      updateGitignoreForDir(dir, [], addEntries);
    }

    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      if (fs.statSync(fullPath).isDirectory() && !item.startsWith('.')) {
        walkDir(fullPath);
      }
    }
  };

  walkDir(outputDir);
}

async function getPackageFiles(
  packageName: string,
  cwd?: string,
): Promise<Array<{ relPath: string; fullPath: string }>> {
  const pkgPath = require.resolve(`${packageName}/package.json`, {
    // eslint-disable-next-line no-undefined
    paths: cwd ? [cwd] : undefined,
  });
  const packagePath = path.dirname(pkgPath);

  if (!packagePath) {
    throw new Error(`Cannot locate installed package: ${packageName}`);
  }

  const contents: Array<{ relPath: string; fullPath: string }> = [];

  const walkDir = (dir: string, basePath = ''): void => {
    for (const file of fs.readdirSync(dir)) {
      if (file === MARKER_FILE) continue;

      const fullPath = path.join(dir, file);
      const relPath = basePath ? `${basePath}/${file}` : file;

      if (fs.statSync(fullPath).isDirectory()) {
        walkDir(fullPath, relPath);
      } else {
        contents.push({ relPath, fullPath });
      }
    }
  };

  walkDir(packagePath);
  return contents;
}

async function installPackage(
  packageName: string,
  version: string | undefined,
  packageManager: 'npm' | 'yarn' | 'pnpm',
  cwd?: string,
): Promise<void> {
  const packageSpec = version ? `${packageName}@${version}` : `${packageName}@latest`;

  let cmd: string;
  switch (packageManager) {
    case 'pnpm':
      cmd = `pnpm add ${packageSpec}`;
      break;
    case 'yarn':
      cmd = `yarn add ${packageSpec}`;
      break;
    default:
      cmd = `npm install ${packageSpec}`;
  }

  execSync(cmd, { encoding: 'utf8', stdio: 'pipe', cwd });
}

async function ensurePackageInstalled(
  packageName: string,
  version: string | undefined,
  packageManager: 'npm' | 'yarn' | 'pnpm',
  cwd?: string,
): Promise<string> {
  const existingVersion = getInstalledPackageVersion(packageName, cwd);

  if (!existingVersion) {
    await installPackage(packageName, version, packageManager, cwd);
  }

  const installedVersion = getInstalledPackageVersion(packageName, cwd);
  if (!installedVersion) {
    throw new Error(`Couldn't find package ${packageName}`);
  }
  if (version && !satisfies(installedVersion, version)) {
    throw new Error(
      `Installed version ${installedVersion} of package '${packageName}' does not match constraint ${version}`,
    );
  }

  return installedVersion;
}

/**
 * Load managed files from all marker files under outputDir, keyed by relative path.
 * Each value carries the package ownership metadata.
 */
function loadManagedFilesMap(outputDir: string): Map<string, ManagedFileMetadata> {
  const files = new Map<string, ManagedFileMetadata>();

  const walkDir = (dir: string): void => {
    if (!fs.existsSync(dir)) return;

    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (item === MARKER_FILE) {
        try {
          const managedFiles = readCsvMarker(fullPath);
          const markerDir = path.dirname(fullPath);
          const relMarkerDir = path.relative(outputDir, markerDir);

          for (const managed of managedFiles) {
            const relPath =
              relMarkerDir === '.' ? managed.path : path.join(relMarkerDir, managed.path);
            files.set(relPath, managed);
          }
        } catch {
          // Ignore unreadable marker files
        }
      } else if (stat.isDirectory() && !item.startsWith('.')) {
        walkDir(fullPath);
      }
    }
  };

  walkDir(outputDir);
  return files;
}

/**
 * Load all managed files from marker files under outputDir as a flat list.
 * Paths are relative to outputDir.
 */
function loadAllManagedFiles(outputDir: string): ManagedFileMetadata[] {
  const files: ManagedFileMetadata[] = [];

  const walkDir = (dir: string): void => {
    if (!fs.existsSync(dir)) return;

    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (item === MARKER_FILE) {
        try {
          const managedFiles = readCsvMarker(fullPath);
          const markerDir = path.dirname(fullPath);
          const relMarkerDir = path.relative(outputDir, markerDir);

          for (const managed of managedFiles) {
            const relPath =
              relMarkerDir === '.' ? managed.path : path.join(relMarkerDir, managed.path);
            files.push({
              path: relPath,
              packageName: managed.packageName,
              packageVersion: managed.packageVersion,
            });
          }
        } catch {
          // Ignore unreadable marker files
        }
      } else if (stat.isDirectory() && !item.startsWith('.')) {
        walkDir(fullPath);
      }
    }
  };

  walkDir(outputDir);
  return files;
}

function cleanupEmptyMarkers(outputDir: string): void {
  const walkDir = (dir: string): void => {
    if (!fs.existsSync(dir)) return;

    for (const file of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, file);

      if (file === MARKER_FILE) {
        try {
          const managedFiles = readCsvMarker(fullPath);
          if (managedFiles.length === 0) {
            fs.chmodSync(fullPath, 0o644);
            fs.unlinkSync(fullPath);
          }
        } catch {
          // Ignore unreadable marker files
        }
      } else if (fs.statSync(fullPath).isDirectory() && !file.startsWith('.')) {
        walkDir(fullPath);
      }
    }
  };

  walkDir(outputDir);
}

function cleanupEmptyDirs(outputDir: string): void {
  const walkDir = (dir: string): boolean => {
    if (!fs.existsSync(dir)) return true;

    let isEmpty = true;
    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      if (fs.statSync(fullPath).isDirectory() && !item.startsWith('.')) {
        const childEmpty = walkDir(fullPath);
        if (!childEmpty) isEmpty = false;
      } else {
        isEmpty = false;
      }
    }

    if (isEmpty && dir !== outputDir) {
      fs.rmdirSync(dir);
      return true;
    }
    return isEmpty;
  };

  walkDir(outputDir);
}

// eslint-disable-next-line complexity
async function extractFiles(
  config: ConsumerConfig,
): Promise<Pick<ConsumerResult, 'added' | 'modified' | 'deleted' | 'skipped'>> {
  const changes: Pick<ConsumerResult, 'added' | 'modified' | 'deleted' | 'skipped'> = {
    added: [],
    modified: [],
    deleted: [],
    skipped: [],
  };

  const installedVersion = getInstalledPackageVersion(config.packageName, config.cwd);
  if (!installedVersion) {
    throw new Error(`Failed to determine installed version of package ${config.packageName}`);
  }

  const packageFiles = await getPackageFiles(config.packageName, config.cwd);
  const addedByDir = new Map<string, ManagedFileMetadata[]>();
  const existingManagedMap = loadManagedFilesMap(config.outputDir);
  const deletedOnlyDirs = new Set<string>();
  // eslint-disable-next-line functional/no-let
  let wasForced = false;

  for (const packageFile of packageFiles) {
    if (
      !matchesFilenamePattern(
        packageFile.relPath,
        config.filenamePatterns ?? DEFAULT_FILENAME_PATTERNS,
      ) ||
      !matchesContentRegex(packageFile.fullPath, config.contentRegexes)
    ) {
      continue;
    }

    const destPath = path.join(config.outputDir, packageFile.relPath);
    ensureDir(path.dirname(destPath));

    const existingOwner = existingManagedMap.get(packageFile.relPath);

    if (fs.existsSync(destPath)) {
      if (existingOwner?.packageName === config.packageName) {
        if (calculateFileHash(packageFile.fullPath) === calculateFileHash(destPath)) {
          changes.skipped.push(packageFile.relPath);
        } else {
          copyFile(packageFile.fullPath, destPath);
          changes.modified.push(packageFile.relPath);
        }
        wasForced = false;
      } else if (existingOwner && existingOwner.packageName !== config.packageName) {
        throw new Error(
          `Package clash: ${packageFile.relPath} already managed by ${existingOwner.packageName}@${existingOwner.packageVersion}. Cannot extract from ${config.packageName}. Use force: true to override.`,
        );
      } else if (!config.force) {
        throw new Error(
          `File conflict: ${packageFile.relPath} already exists and is not managed by this package. Use force: true to override.`,
        );
      } else {
        copyFile(packageFile.fullPath, destPath);
        changes.added.push(packageFile.relPath);
        wasForced = true;
      }
    } else {
      copyFile(packageFile.fullPath, destPath);
      changes.added.push(packageFile.relPath);
      wasForced = false;
    }

    fs.chmodSync(destPath, 0o444);

    const dir = path.dirname(packageFile.relPath) || '.';
    if (!addedByDir.has(dir)) {
      addedByDir.set(dir, []);
    }
    addedByDir.get(dir)!.push({
      path: path.basename(packageFile.relPath),
      packageName: config.packageName,
      packageVersion: installedVersion,
      force: wasForced,
    });
  }

  // Delete files that were managed by this package but are no longer in the package
  for (const [relPath, owner] of existingManagedMap) {
    if (owner.packageName !== config.packageName) continue;

    const fileDir = path.dirname(relPath) === '.' ? '.' : path.dirname(relPath);
    const dirFiles = addedByDir.get(fileDir) ?? [];
    const stillPresent = dirFiles.some((m) => m.path === path.basename(relPath));

    if (!stillPresent) {
      const fullPath = path.join(config.outputDir, relPath);
      if (fs.existsSync(fullPath)) {
        removeFile(fullPath);
        changes.deleted.push(relPath);
      }
      const dir = path.dirname(relPath) === '.' ? '.' : path.dirname(relPath);
      if (!addedByDir.has(dir)) {
        deletedOnlyDirs.add(dir);
      }
    }
  }

  // Write updated marker files
  // eslint-disable-next-line unicorn/no-keyword-prefix
  for (const [dir, newFiles] of addedByDir) {
    const markerDir = dir === '.' ? config.outputDir : path.join(config.outputDir, dir);
    ensureDir(markerDir);
    const markerPath = path.join(markerDir, MARKER_FILE);

    // eslint-disable-next-line unicorn/no-null
    let existingFiles: ManagedFileMetadata[] = [];
    if (fs.existsSync(markerPath)) {
      existingFiles = readCsvMarker(markerPath);
    }

    // Keep entries from other packages, replace entries from this package
    const mergedFiles: ManagedFileMetadata[] = [
      ...existingFiles.filter((m) => m.packageName !== config.packageName),
      // eslint-disable-next-line unicorn/no-keyword-prefix
      ...newFiles,
    ];

    writeCsvMarker(markerPath, mergedFiles);
  }

  // Update marker files for directories where all managed files were removed (no new files added)
  for (const dir of deletedOnlyDirs) {
    const markerDir = dir === '.' ? config.outputDir : path.join(config.outputDir, dir);
    const markerPath = path.join(markerDir, MARKER_FILE);

    if (!fs.existsSync(markerPath)) continue;

    try {
      const existingFiles = readCsvMarker(markerPath);
      const mergedFiles = existingFiles.filter((m) => m.packageName !== config.packageName);

      if (mergedFiles.length === 0) {
        fs.chmodSync(markerPath, 0o644);
        fs.unlinkSync(markerPath);
      } else {
        writeCsvMarker(markerPath, mergedFiles);
      }
    } catch {
      // Ignore unreadable marker files
    }
  }

  cleanupEmptyMarkers(config.outputDir);
  return changes;
}

/**
 * Extract files from published package to output directory
 */
export async function extract(config: ConsumerConfig): Promise<ConsumerResult> {
  ensureDir(config.outputDir);

  const packageManager = config.packageManager ?? detectPackageManager();
  const installedVersion = await ensurePackageInstalled(
    config.packageName,
    config.version,
    packageManager,
    config.cwd,
  );

  const changes = await extractFiles(config);
  cleanupEmptyMarkers(config.outputDir);
  // Always clean up .gitignore entries for removed files; only add new entries when gitignore: true.
  updateGitignores(config.outputDir, config.gitignore ?? false);
  // Run after gitignore cleanup so dirs kept alive only by a .gitignore get removed.
  cleanupEmptyDirs(config.outputDir);

  return {
    added: changes.added,
    modified: changes.modified,
    deleted: changes.deleted,
    skipped: changes.skipped,
    sourcePackage: {
      name: config.packageName,
      version: installedVersion,
    },
  };
}

/**
 * Check if managed files are in sync with the published package
 */
export async function check(config: ConsumerConfig): Promise<CheckResult> {
  const installedVersion = getInstalledPackageVersion(config.packageName, config.cwd);

  if (!installedVersion) {
    throw new Error(`Package ${config.packageName} is not installed. Install it first.`);
  }

  const managedFiles = loadAllManagedFiles(config.outputDir).filter(
    (m) => m.packageName === config.packageName,
  );

  const packageFiles = await getPackageFiles(config.packageName, config.cwd);
  const packageHashMap = new Map(
    packageFiles.map((f) => [f.relPath, calculateFileHash(f.fullPath)]),
  );

  const differences = {
    missing: [] as string[],
    extra: [] as string[],
    modified: [] as string[],
  };

  for (const managedFile of managedFiles) {
    const localPath = path.join(config.outputDir, managedFile.path);

    if (!fs.existsSync(localPath)) {
      differences.missing.push(managedFile.path);
      continue;
    }

    const packageHash = packageHashMap.get(managedFile.path);
    if (packageHash && calculateFileHash(localPath) !== packageHash) {
      differences.modified.push(managedFile.path);
    }
  }

  for (const pkgFile of packageFiles) {
    const isManagedByThisPackage = managedFiles.some((m) => m.path === pkgFile.relPath);
    if (!isManagedByThisPackage && fs.existsSync(path.join(config.outputDir, pkgFile.relPath))) {
      differences.extra.push(pkgFile.relPath);
    }
  }

  return {
    ok:
      differences.missing.length === 0 &&
      differences.modified.length === 0 &&
      differences.extra.length === 0,
    differences,
    sourcePackage: {
      name: config.packageName,
      version: installedVersion,
    },
  };
}
