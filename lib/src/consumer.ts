/* eslint-disable functional/no-try-statements */
/* eslint-disable functional/no-let */
/* eslint-disable no-continue */
/* eslint-disable functional/immutable-data */
/* eslint-disable no-restricted-syntax */
/* eslint-disable max-depth */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { satisfies } from 'semver';

import {
  ConsumerConfig,
  ConsumerResult,
  CheckResult,
  ManagedFileMetadata,
  ProgressEvent,
  DEFAULT_FILENAME_PATTERNS,
  ContentReplacementConfig,
} from './types';
import {
  ensureDir,
  removeFile,
  copyFile,
  calculateFileHash,
  calculateBufferHash,
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
 * Optimise the list of managed file paths for use in .gitignore.
 * When every file inside a directory (recursively, excluding MARKER_FILE, GITIGNORE_FILE, and
 * symlinks) is present in managedPaths, the whole directory is represented as "dir/" rather than
 * listing each file individually.  Root-level files (no slash) are always emitted as-is.
 *
 * @param managedPaths - Paths relative to outputDir (e.g. ["docs/guide.md", "README.md"])
 * @param outputDir    - Absolute path to the root used to inspect actual disk contents
 */
export function compressGitignoreEntries(managedPaths: string[], outputDir: string): string[] {
  const managedSet = new Set(managedPaths);

  // Returns true when every non-special, non-symlink file inside absDir (recursively)
  // appears in managedSet under its full outputDir-relative path (relDir prefix included).
  const isDirFullyManaged = (absDir: string, relDir: string): boolean => {
    if (!fs.existsSync(absDir)) return false;
    for (const entry of fs.readdirSync(absDir)) {
      if (entry === MARKER_FILE || entry === GITIGNORE_FILE) continue;
      const absEntry = path.join(absDir, entry);
      const relEntry = `${relDir}/${entry}`;
      const lstat = fs.lstatSync(absEntry);
      if (lstat.isSymbolicLink()) continue;
      if (lstat.isDirectory()) {
        if (!isDirFullyManaged(absEntry, relEntry)) return false;
      } else if (!managedSet.has(relEntry)) return false;
    }
    return true;
  };

  // paths: managed paths relative to the current directory scope
  // absRoot: absolute path of the current directory scope
  // relRoot: path of the current scope relative to outputDir (empty string at top level)
  const compress = (paths: string[], absRoot: string, relRoot: string): string[] => {
    const result: string[] = [];
    const subdirNames = new Set<string>();

    for (const p of paths) {
      const slashIdx = p.indexOf('/');
      if (slashIdx === -1) {
        // File lives directly in this scope — emit its full outputDir-relative path
        result.push(relRoot ? `${relRoot}/${p}` : p);
      } else {
        subdirNames.add(p.slice(0, slashIdx));
      }
    }

    for (const dirName of subdirNames) {
      const absDir = path.join(absRoot, dirName);
      const relDir = relRoot ? `${relRoot}/${dirName}` : dirName;
      const prefix = `${dirName}/`;
      const subPaths = paths.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));

      if (isDirFullyManaged(absDir, relDir)) {
        result.push(`${relDir}/`);
      } else {
        result.push(...compress(subPaths, absDir, relDir));
      }
    }

    return result;
  };

  return compress(managedPaths, outputDir, '');
}

/**
 * Find the nearest .npmdata marker file by walking up from fromDir to outputDir (inclusive).
 * Returns the path to the marker file, or null if none found within the outputDir boundary.
 */
export function findNearestMarkerPath(fromDir: string, outputDir: string): string | null {
  let dir = fromDir;
  const resolvedOutput = path.resolve(outputDir);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const markerPath = path.join(dir, MARKER_FILE);
    if (fs.existsSync(markerPath)) return markerPath;

    if (path.resolve(dir) === resolvedOutput) break;

    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  // eslint-disable-next-line unicorn/no-null
  return null;
}

/**
 * Write one .gitignore at outputDir containing all managed file paths (relative to outputDir),
 * and remove any npmdata sections from .gitignore files in subdirectories.
 * When addEntries is false, existing sections are updated/removed but no new
 * sections are created — use this to clean up without opting into gitignore management.
 */
function updateGitignores(outputDir: string, addEntries = true): void {
  if (!fs.existsSync(outputDir)) return;

  // Remove npmdata sections from all subdirectory .gitignore files (migration / cleanup of old format)
  const cleanupSubDirGitignores = (dir: string): void => {
    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      const lstat = fs.lstatSync(fullPath);
      if (!lstat.isSymbolicLink() && lstat.isDirectory()) {
        const subGitignore = path.join(fullPath, GITIGNORE_FILE);
        if (fs.existsSync(subGitignore)) {
          updateGitignoreForDir(fullPath, [], false);
        }
        cleanupSubDirGitignores(fullPath);
      }
    }
  };

  cleanupSubDirGitignores(outputDir);

  // Update (or remove) the single .gitignore at outputDir
  const rootMarkerPath = path.join(outputDir, MARKER_FILE);
  if (fs.existsSync(rootMarkerPath)) {
    try {
      const managedFiles = readCsvMarker(rootMarkerPath);
      const rawPaths = managedFiles.map((m) => m.path);
      const optimisedPaths = compressGitignoreEntries(rawPaths, outputDir);
      updateGitignoreForDir(outputDir, optimisedPaths, addEntries);
    } catch {
      // Ignore unreadable marker files
    }
  } else {
    // Clean up any leftover npmdata section at root
    updateGitignoreForDir(outputDir, [], false);
  }
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
      const lstat = fs.lstatSync(fullPath);

      if (!lstat.isSymbolicLink() && lstat.isDirectory()) {
        walkDir(fullPath, relPath);
      } else if (!lstat.isSymbolicLink()) {
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
 * Load all managed files from the root marker file at outputDir.
 * Paths stored in the marker are already relative to outputDir.
 * Uses findNearestMarkerPath starting from outputDir itself.
 */
function loadAllManagedFiles(outputDir: string): ManagedFileMetadata[] {
  if (!fs.existsSync(outputDir)) return [];

  const markerPath = findNearestMarkerPath(outputDir, outputDir);
  if (!markerPath) return [];

  try {
    return readCsvMarker(markerPath);
  } catch {
    console.warn(`Warning: Failed to read marker file at ${markerPath}. Skipping.`); // eslint-disable-line no-console
    return [];
  }
}

/**
 * Load managed files from all marker files under outputDir, keyed by relative path.
 * Each value carries the package ownership metadata.
 */
function loadManagedFilesMap(outputDir: string): Map<string, ManagedFileMetadata> {
  return new Map(loadAllManagedFiles(outputDir).map((m) => [m.path, m]));
}

function cleanupEmptyMarkers(outputDir: string): void {
  if (!fs.existsSync(outputDir)) return;

  const markerPath = path.join(outputDir, MARKER_FILE);
  if (!fs.existsSync(markerPath)) return;

  try {
    const managedFiles = readCsvMarker(markerPath);
    if (managedFiles.length === 0) {
      fs.chmodSync(markerPath, 0o644);
      fs.unlinkSync(markerPath);
    }
  } catch {
    // Ignore unreadable marker files
  }
}

function cleanupEmptyDirs(outputDir: string): void {
  const walkDir = (dir: string): boolean => {
    if (!fs.existsSync(dir)) return true;

    let isEmpty = true;
    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      const lstat = fs.lstatSync(fullPath);
      if (!lstat.isSymbolicLink() && lstat.isDirectory()) {
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
  const extractedFiles: ManagedFileMetadata[] = [];
  const existingManagedMap = loadManagedFilesMap(config.outputDir);
  // Tracks full relPaths force-claimed from a different package so the
  // marker-file merge can evict the previous owner's entry.
  const forceClaimedPaths = new Set<string>();
  // eslint-disable-next-line functional/no-let
  let wasForced = false;

  try {
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

      // In unmanaged mode, skip files that already exist on disk.
      if (config.unmanaged && fs.existsSync(destPath)) {
        changes.skipped.push(packageFile.relPath);
        emit?.({ type: 'file-skipped', packageName, file: packageFile.relPath });
        continue;
      }

      // In keep-existing mode, skip files that already exist on disk but create missing ones normally.
      if (config.keepExisting && fs.existsSync(destPath)) {
        changes.skipped.push(packageFile.relPath);
        emit?.({ type: 'file-skipped', packageName, file: packageFile.relPath });
        continue;
      }

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
            // Evict the previous owner's entry from the root marker file.
            forceClaimedPaths.add(packageFile.relPath);
          }
        }
      } else {
        if (!dryRun) copyFile(packageFile.fullPath, destPath);
        changes.added.push(packageFile.relPath);
        emit?.({ type: 'file-added', packageName, file: packageFile.relPath });
        wasForced = false;
      }

      if (!dryRun && !config.unmanaged && fs.existsSync(destPath)) fs.chmodSync(destPath, 0o444);

      if (!config.unmanaged) {
        // eslint-disable-next-line functional/immutable-data
        extractedFiles.push({
          path: packageFile.relPath,
          packageName,
          packageVersion: installedVersion,
          force: wasForced,
        });
      }
    }

    // Delete files that were managed by this package but are no longer in the package
    for (const [relPath, owner] of existingManagedMap) {
      if (owner.packageName !== packageName) continue;

      const stillPresent = extractedFiles.some((m) => m.path === relPath);

      if (!stillPresent) {
        const fullPath = path.join(config.outputDir, relPath);
        if (fs.existsSync(fullPath)) {
          if (!dryRun) removeFile(fullPath);
          changes.deleted.push(relPath);
          emit?.({ type: 'file-deleted', packageName, file: relPath });
        }
      }
    }

    if (!dryRun && !config.unmanaged) {
      // Write a single root marker at outputDir with all managed file paths (relative to outputDir)
      const rootMarkerPath = path.join(config.outputDir, MARKER_FILE);

      let existingFiles: ManagedFileMetadata[] = [];
      if (fs.existsSync(rootMarkerPath)) {
        existingFiles = readCsvMarker(rootMarkerPath);
      }

      // Keep entries from other packages, evict entries from force-claimed paths.
      const mergedFiles: ManagedFileMetadata[] = [
        ...existingFiles.filter(
          (m) => m.packageName !== packageName && !forceClaimedPaths.has(m.path),
        ),
        ...extractedFiles,
      ];

      if (mergedFiles.length === 0) {
        if (fs.existsSync(rootMarkerPath)) {
          fs.chmodSync(rootMarkerPath, 0o644);
          fs.unlinkSync(rootMarkerPath);
        }
      } else {
        writeCsvMarker(rootMarkerPath, mergedFiles);
      }

      cleanupEmptyMarkers(config.outputDir);
    }
  } catch (error) {
    // On error, delete all files that were created during this extraction run
    if (!dryRun) {
      for (const relPath of changes.added) {
        const fullPath = path.join(config.outputDir, relPath);
        if (fs.existsSync(fullPath)) {
          try {
            removeFile(fullPath);
          } catch {
            // ignore cleanup errors
          }
        }
      }
      cleanupEmptyDirs(config.outputDir);
    }
    throw error;
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

  if (config.force && config.keepExisting) {
    throw new Error('force and keepExisting cannot be used together');
  }

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
    if (!config.unmanaged) {
      cleanupEmptyMarkers(config.outputDir);
      // Always clean up .gitignore entries for removed files; only add new entries when gitignore: true.
      updateGitignores(config.outputDir, config.gitignore ?? true);
    }
    // Run after gitignore cleanup so dirs kept alive only by a .gitignore get removed.
    cleanupEmptyDirs(config.outputDir);
  }

  return {
    ...totalChanges,
    sourcePackages,
  };
}

/**
 * Compute the expected hash of a package source file as it should appear in the
 * output directory after all content replacements have been applied.
 *
 * When no replacement config is provided (or none matches the file), the hash is
 * computed directly from the on-disk source content.  When one or more replacements
 * match, the source content is transformed in memory and the resulting hash is
 * returned – this makes check() tolerant of post-extract content replacements.
 */
// eslint-disable-next-line complexity
function computeExpectedHash(
  sourceFullPath: string,
  relPath: string,
  outputDir: string,
  cwd: string,
  replacements?: ContentReplacementConfig[],
): string {
  if (!replacements || replacements.length === 0) {
    return calculateFileHash(sourceFullPath);
  }

  // The workspace path of the extracted file, relative to cwd, is used to
  // evaluate the replacement's `files` glob (which is also relative to cwd).
  const workspaceRelPath = path.relative(cwd, path.join(outputDir, relPath));

  const applicable = replacements.filter((r) =>
    matchesFilenamePattern(workspaceRelPath, [r.files]),
  );

  if (applicable.length === 0) {
    return calculateFileHash(sourceFullPath);
  }

  // eslint-disable-next-line functional/no-let
  let content = fs.readFileSync(sourceFullPath, 'utf8');
  for (const r of applicable) {
    content = content.replaceAll(new RegExp(r.match, 'gm'), r.replace);
  }
  return calculateBufferHash(content);
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

    // Build a hash map of the installed package files (filtered the same way).
    // When content replacements are configured, the expected hash for each affected file
    // is computed from the source content AFTER applying the replacements, so that files
    // modified in-place by a post-extract replacement are not reported as out of sync.
    // eslint-disable-next-line no-await-in-loop
    const packageFiles = await getPackageFiles(name, config.cwd);
    const filteredPackageFiles = packageFiles.filter(
      (f) =>
        matchesFilenamePattern(f.relPath, config.filenamePatterns ?? DEFAULT_FILENAME_PATTERNS) &&
        matchesContentRegex(f.fullPath, config.contentRegexes),
    );
    const effectiveCwd = config.cwd ?? process.cwd();
    const packageHashMap = new Map(
      filteredPackageFiles.map((f) => [
        f.relPath,
        computeExpectedHash(
          f.fullPath,
          f.relPath,
          config.outputDir,
          effectiveCwd,
          config.contentReplacements,
        ),
      ]),
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
 * Configuration for a purge operation.
 */
export type PurgeConfig = {
  /**
   * Package names whose managed files should be removed.
   * Each entry is a bare package name ("my-pkg") or a name with a semver constraint
   * ("my-pkg@^1.2.3") – the version part is ignored; only the name is used for lookup.
   */
  packages: string[];

  /**
   * Output directory from which managed files will be removed.
   */
  outputDir: string;

  /**
   * When true, simulate the purge without writing anything to disk.
   */
  dryRun?: boolean;

  /**
   * Optional callback called for each file event during purge.
   */
  onProgress?: (event: ProgressEvent) => void;
};

/**
 * Remove all managed files previously extracted by the given packages from outputDir.
 * Reads .npmdata marker files to discover which files are owned by each package,
 * deletes them from disk, updates the marker files, and cleans up empty directories.
 * No package installation is required – only the local marker state is used.
 */
export async function purge(config: PurgeConfig): Promise<ConsumerResult> {
  const dryRun = config.dryRun ?? false;
  const emit = config.onProgress;
  const totalChanges: Pick<ConsumerResult, 'added' | 'modified' | 'deleted' | 'skipped'> = {
    added: [],
    modified: [],
    deleted: [],
    skipped: [],
  };
  const sourcePackages: ConsumerResult['sourcePackages'] = [];

  for (const spec of config.packages) {
    const { name: packageName } = parsePackageSpec(spec);
    const deleted: string[] = [];

    emit?.({ type: 'package-start', packageName, packageVersion: 'unknown' });

    const allManaged = loadManagedFilesMap(config.outputDir);

    for (const [relPath, owner] of allManaged) {
      if (owner.packageName !== packageName) continue;

      const fullPath = path.join(config.outputDir, relPath);
      if (fs.existsSync(fullPath)) {
        if (!dryRun) removeFile(fullPath);
        deleted.push(relPath);
        emit?.({ type: 'file-deleted', packageName, file: relPath });
      }
    }

    if (!dryRun) {
      // Update root marker: remove entries owned by this package.
      const rootMarkerPath = path.join(config.outputDir, MARKER_FILE);
      if (fs.existsSync(rootMarkerPath)) {
        // eslint-disable-next-line functional/no-try-statements
        try {
          const existingFiles = readCsvMarker(rootMarkerPath);
          const mergedFiles = existingFiles.filter((m) => m.packageName !== packageName);

          if (mergedFiles.length === 0) {
            fs.chmodSync(rootMarkerPath, 0o644);
            fs.unlinkSync(rootMarkerPath);
          } else {
            writeCsvMarker(rootMarkerPath, mergedFiles);
          }
        } catch {
          // Ignore unreadable marker files
        }
      }

      cleanupEmptyMarkers(config.outputDir);
      // Clean up any leftover .gitignore sections without adding new ones.
      updateGitignores(config.outputDir, false);
      cleanupEmptyDirs(config.outputDir);
    }

    totalChanges.deleted.push(...deleted);
    sourcePackages.push({
      name: packageName,
      version: 'unknown',
      changes: { added: [], modified: [], deleted, skipped: [] },
    });

    emit?.({ type: 'package-end', packageName, packageVersion: 'unknown' });
  }

  return {
    ...totalChanges,
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
