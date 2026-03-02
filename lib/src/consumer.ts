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
  parsePackageSpec,
} from './utils';

const MARKER_FILE = '.npmdata';
const GITIGNORE_FILE = '.gitignore';
const GITIGNORE_START = '# npmdata:start';
const GITIGNORE_END = '# npmdata:end';

/**
 * Update (or create) a .gitignore in the given directory so that the managed
 * files and the .npmdata marker file are ignored by git.
 * If managedFilenames is empty the npmdata section is removed; if the
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
 * .npmdata marker (to reflect its current managed files) and also clean up
 * any npmdata sections in directories where the marker was removed.
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
      // Clean up any leftover npmdata section
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

  // eslint-disable-next-line functional/no-try-statements
  try {
    execSync(cmd, { encoding: 'utf8', stdio: 'pipe', cwd });
  } catch (error: unknown) {
    const e = error as { stderr?: string; stdout?: string; message?: string };
    const detail = (e.stderr ?? e.stdout ?? e.message ?? String(error)).trim();
    throw new Error(`Failed to install ${packageSpec}: ${detail}`);
  }
}

async function ensurePackageInstalled(
  packageName: string,
  version: string | undefined,
  packageManager: 'npm' | 'yarn' | 'pnpm',
  cwd?: string,
  upgrade?: boolean,
): Promise<string> {
  const existingVersion = getInstalledPackageVersion(packageName, cwd);

  if (!existingVersion) {
    const spec = version ? `${packageName}@${version}` : packageName;
    // eslint-disable-next-line no-console
    console.log(`Installing missing package ${spec}...`);
    await installPackage(packageName, version, packageManager, cwd);
  } else if (upgrade) {
    const spec = version ? `${packageName}@${version}` : packageName;
    // eslint-disable-next-line no-console
    console.log(`Bumping existing package ${spec}...`);
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
  packageName: string,
): Promise<Pick<ConsumerResult, 'added' | 'modified' | 'deleted' | 'skipped'>> {
  const changes: Pick<ConsumerResult, 'added' | 'modified' | 'deleted' | 'skipped'> = {
    added: [],
    modified: [],
    deleted: [],
    skipped: [],
  };

  const dryRun = config.dryRun ?? false;
  const emit = config.onProgress;

  const installedVersion = getInstalledPackageVersion(packageName, config.cwd);
  if (!installedVersion) {
    throw new Error(`Failed to determine installed version of package ${packageName}`);
  }

  emit?.({ type: 'package-start', packageName, packageVersion: installedVersion });

  const packageFiles = await getPackageFiles(packageName, config.cwd);
  const addedByDir = new Map<string, ManagedFileMetadata[]>();
  const existingManagedMap = loadManagedFilesMap(config.outputDir);
  const deletedOnlyDirs = new Set<string>();
  // Tracks basenames (per directory) force-claimed from a different package so the
  // marker-file merge can evict the previous owner's entry.
  const forceClaimedByDir = new Map<string, Set<string>>();
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
    if (!dryRun) ensureDir(path.dirname(destPath));

    const existingOwner = existingManagedMap.get(packageFile.relPath);

    if (fs.existsSync(destPath)) {
      if (existingOwner?.packageName === packageName) {
        if (calculateFileHash(packageFile.fullPath) === calculateFileHash(destPath)) {
          changes.skipped.push(packageFile.relPath);
          emit?.({ type: 'file-skipped', packageName, file: packageFile.relPath });
        } else {
          if (!dryRun) copyFile(packageFile.fullPath, destPath);
          changes.modified.push(packageFile.relPath);
          emit?.({ type: 'file-modified', packageName, file: packageFile.relPath });
        }
        wasForced = false;
      } else {
        // File exists but is owned by a different package (clash) or is unmanaged (conflict).
        // Behaviour is identical in both cases: throw when force is false, overwrite when true.
        if (!config.force) {
          if (existingOwner) {
            throw new Error(
              `Package clash: ${packageFile.relPath} already managed by ${existingOwner.packageName}@${existingOwner.packageVersion}. Cannot extract from ${packageName}. Use force: true to override.`,
            );
          }
          throw new Error(
            `File conflict: ${packageFile.relPath} already exists and is not managed by npmdata. Use force: true to override.`,
          );
        }
        // force=true: overwrite the existing file and take ownership.
        if (!dryRun) copyFile(packageFile.fullPath, destPath);
        changes.modified.push(packageFile.relPath);
        emit?.({ type: 'file-modified', packageName, file: packageFile.relPath });
        wasForced = true;
        if (existingOwner) {
          // Evict the previous owner's entry from the marker file.
          const claimDir = path.dirname(packageFile.relPath) || '.';
          if (!forceClaimedByDir.has(claimDir)) forceClaimedByDir.set(claimDir, new Set());
          forceClaimedByDir.get(claimDir)!.add(path.basename(packageFile.relPath));
        }
      }
    } else {
      if (!dryRun) copyFile(packageFile.fullPath, destPath);
      changes.added.push(packageFile.relPath);
      emit?.({ type: 'file-added', packageName, file: packageFile.relPath });
      wasForced = false;
    }

    if (!dryRun && fs.existsSync(destPath)) fs.chmodSync(destPath, 0o444);

    const dir = path.dirname(packageFile.relPath) || '.';
    if (!addedByDir.has(dir)) {
      addedByDir.set(dir, []);
    }
    addedByDir.get(dir)!.push({
      path: path.basename(packageFile.relPath),
      packageName,
      packageVersion: installedVersion,
      force: wasForced,
    });
  }

  // Delete files that were managed by this package but are no longer in the package
  for (const [relPath, owner] of existingManagedMap) {
    if (owner.packageName !== packageName) continue;

    const fileDir = path.dirname(relPath) === '.' ? '.' : path.dirname(relPath);
    const dirFiles = addedByDir.get(fileDir) ?? [];
    const stillPresent = dirFiles.some((m) => m.path === path.basename(relPath));

    if (!stillPresent) {
      const fullPath = path.join(config.outputDir, relPath);
      if (fs.existsSync(fullPath)) {
        if (!dryRun) removeFile(fullPath);
        changes.deleted.push(relPath);
        emit?.({ type: 'file-deleted', packageName, file: relPath });
      }
      const dir = path.dirname(relPath) === '.' ? '.' : path.dirname(relPath);
      if (!addedByDir.has(dir)) {
        deletedOnlyDirs.add(dir);
      }
    }
  }

  if (!dryRun) {
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

      // Keep entries from other packages, replace entries from this package.
      // Also evict entries from other packages for any file force-claimed in this pass.
      const claimedInDir = forceClaimedByDir.get(dir);
      const mergedFiles: ManagedFileMetadata[] = [
        ...existingFiles.filter((m) => m.packageName !== packageName && !claimedInDir?.has(m.path)),
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
        const mergedFiles = existingFiles.filter((m) => m.packageName !== packageName);

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
  }

  emit?.({ type: 'package-end', packageName, packageVersion: installedVersion });
  return changes;
}

/**
 * Extract files from published packages to output directory.
 *
 * Phase 1 validates and installs every package before touching disk.
 * Phase 2 runs file extraction for all packages in parallel.
 * When dryRun is true no files are written; the result reflects what would change.
 */
export async function extract(config: ConsumerConfig): Promise<ConsumerResult> {
  const dryRun = config.dryRun ?? false;
  if (!dryRun) ensureDir(config.outputDir);

  const packageManager = config.packageManager ?? detectPackageManager(config.cwd);
  const sourcePackages: ConsumerResult['sourcePackages'] = [];
  const totalChanges: Pick<ConsumerResult, 'added' | 'modified' | 'deleted' | 'skipped'> = {
    added: [],
    modified: [],
    deleted: [],
    skipped: [],
  };

  // Phase 1: validate and install every package before touching the disk.
  // If any package is missing or at a wrong version, we abort before writing anything.
  const resolvedPackages: Array<{
    name: string;
    version: string | undefined;
    installedVersion: string;
  }> = [];
  for (const spec of config.packages) {
    const { name, version } = parsePackageSpec(spec);
    // eslint-disable-next-line no-await-in-loop
    const installedVersion = await ensurePackageInstalled(
      name,
      version,
      packageManager,
      config.cwd,
      config.upgrade,
    );
    resolvedPackages.push({ name, version, installedVersion });
  }

  // Phase 2: all packages are verified — extract files serially so progress events are grouped by package.
  for (const { name, installedVersion } of resolvedPackages) {
    // eslint-disable-next-line no-await-in-loop
    const changes = await extractFiles(config, name);
    totalChanges.added.push(...changes.added);
    totalChanges.modified.push(...changes.modified);
    totalChanges.deleted.push(...changes.deleted);
    totalChanges.skipped.push(...changes.skipped);
    sourcePackages.push({ name, version: installedVersion, changes });
  }

  if (!dryRun) {
    cleanupEmptyMarkers(config.outputDir);
    // Always clean up .gitignore entries for removed files; only add new entries when gitignore: true.
    updateGitignores(config.outputDir, config.gitignore ?? false);
    // Run after gitignore cleanup so dirs kept alive only by a .gitignore get removed.
    cleanupEmptyDirs(config.outputDir);
  }

  return {
    ...totalChanges,
    sourcePackages,
  };
}

/**
 * Check if managed files are in sync with published packages.
 *
 * Performs a bidirectional comparison:
 * - Files in the .npmdata marker that are missing from or modified in the output directory.
 * - Files present in the package (matching filters) that have not been extracted yet ("extra").
 *
 * If a version constraint is specified (e.g. "my-pkg@^1.0.0"), the installed version is
 * validated against it so stale installs are caught.
 */
export async function check(config: ConsumerConfig): Promise<CheckResult> {
  const sourcePackages: CheckResult['sourcePackages'] = [];
  const totalDifferences: CheckResult['differences'] = {
    missing: [],
    modified: [],
    extra: [],
  };

  for (const spec of config.packages) {
    const { name, version: constraint } = parsePackageSpec(spec);
    const installedVersion = getInstalledPackageVersion(name, config.cwd);

    if (!installedVersion) {
      throw new Error(`Package ${name} is not installed. Run 'extract' first.`);
    }

    if (constraint && !satisfies(installedVersion, constraint)) {
      throw new Error(
        `Installed version ${installedVersion} of package '${name}' does not satisfy constraint ${constraint}. Run 'extract' to update.`,
      );
    }

    // Load marker entries for this package and apply the --files filter
    const markerFiles = loadAllManagedFiles(config.outputDir)
      .filter((m) => m.packageName === name)
      .filter((m) =>
        matchesFilenamePattern(m.path, config.filenamePatterns ?? DEFAULT_FILENAME_PATTERNS),
      );
    const markerPaths = new Set(markerFiles.map((m) => m.path));

    // Build a hash map of the installed package files (filtered the same way)
    // eslint-disable-next-line no-await-in-loop
    const packageFiles = await getPackageFiles(name, config.cwd);
    const filteredPackageFiles = packageFiles.filter(
      (f) =>
        matchesFilenamePattern(f.relPath, config.filenamePatterns ?? DEFAULT_FILENAME_PATTERNS) &&
        matchesContentRegex(f.fullPath, config.contentRegexes),
    );
    const packageHashMap = new Map(
      filteredPackageFiles.map((f) => [f.relPath, calculateFileHash(f.fullPath)]),
    );

    const pkgDiff: CheckResult['sourcePackages'][number]['differences'] = {
      missing: [],
      modified: [],
      extra: [],
    };

    // Check marker entries against local files and package contents
    for (const markerFile of markerFiles) {
      const localPath = path.join(config.outputDir, markerFile.path);

      if (!fs.existsSync(localPath)) {
        pkgDiff.missing.push(markerFile.path);
        continue;
      }

      const packageHash = packageHashMap.get(markerFile.path);
      // eslint-disable-next-line no-undefined
      if (packageHash !== undefined && calculateFileHash(localPath) !== packageHash) {
        pkgDiff.modified.push(markerFile.path);
      }
    }

    // Detect package files that were never extracted (not in the marker)
    for (const [relPath] of packageHashMap) {
      if (!markerPaths.has(relPath)) {
        pkgDiff.extra.push(relPath);
      }
    }

    const pkgOk =
      pkgDiff.missing.length === 0 && pkgDiff.modified.length === 0 && pkgDiff.extra.length === 0;
    sourcePackages.push({ name, version: installedVersion, ok: pkgOk, differences: pkgDiff });

    totalDifferences.missing.push(...pkgDiff.missing);
    totalDifferences.modified.push(...pkgDiff.modified);
    totalDifferences.extra.push(...pkgDiff.extra);
  }

  return {
    ok:
      totalDifferences.missing.length === 0 &&
      totalDifferences.modified.length === 0 &&
      totalDifferences.extra.length === 0,
    differences: totalDifferences,
    sourcePackages,
  };
}

/**
 * List all managed files currently extracted in outputDir, grouped by package.
 */
export function list(outputDir: string): Array<{
  packageName: string;
  packageVersion: string;
  files: string[];
}> {
  const allManaged = loadAllManagedFiles(outputDir);

  const grouped = new Map<
    string,
    { packageName: string; packageVersion: string; files: string[] }
  >();

  for (const managed of allManaged) {
    const key = `${managed.packageName}@${managed.packageVersion}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        packageName: managed.packageName,
        packageVersion: managed.packageVersion,
        files: [],
      });
    }
    grouped.get(key)!.files.push(managed.path);
  }

  return [...grouped.values()].map((entry) => ({
    ...entry,
    files: entry.files.sort(),
  }));
}
