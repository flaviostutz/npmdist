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
  FolderPublisherMarker,
  ManagedFileMetadata,
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
  readJsonFile,
  writeJsonFile,
} from './utils';

const MARKER_FILE = '.folder-publisher';

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
          const marker = readJsonFile<FolderPublisherMarker>(fullPath);
          const markerDir = path.dirname(fullPath);
          const relMarkerDir = path.relative(outputDir, markerDir);

          for (const managed of marker.managedFiles) {
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
          const marker = readJsonFile<FolderPublisherMarker>(fullPath);
          const markerDir = path.dirname(fullPath);
          const relMarkerDir = path.relative(outputDir, markerDir);

          for (const managed of marker.managedFiles) {
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
          const marker = readJsonFile<FolderPublisherMarker>(fullPath);
          if (!marker.managedFiles || marker.managedFiles.length === 0) {
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

// eslint-disable-next-line complexity
async function extractFiles(config: ConsumerConfig): Promise<ConsumerResult['changes']> {
  const changes: ConsumerResult['changes'] = {
    created: [],
    updated: [],
    deleted: [],
  };

  const installedVersion = getInstalledPackageVersion(config.packageName, config.cwd);
  if (!installedVersion) {
    throw new Error(`Failed to determine installed version of package ${config.packageName}`);
  }

  const packageFiles = await getPackageFiles(config.packageName, config.cwd);
  const addedByDir = new Map<string, ManagedFileMetadata[]>();
  const existingManagedMap = loadManagedFilesMap(config.outputDir);

  for (const packageFile of packageFiles) {
    if (
      !matchesFilenamePattern(packageFile.relPath, config.filenamePatterns) ||
      !matchesContentRegex(packageFile.fullPath, config.contentRegexes)
    ) {
      continue;
    }

    const destPath = path.join(config.outputDir, packageFile.relPath);
    ensureDir(path.dirname(destPath));

    const existingOwner = existingManagedMap.get(packageFile.relPath);

    if (fs.existsSync(destPath)) {
      if (existingOwner?.packageName === config.packageName) {
        copyFile(packageFile.fullPath, destPath);
        changes.updated.push(packageFile.relPath);
      } else if (existingOwner && existingOwner.packageName !== config.packageName) {
        throw new Error(
          `Package clash: ${packageFile.relPath} already managed by ${existingOwner.packageName}@${existingOwner.packageVersion}. Cannot extract from ${config.packageName}. Use allowConflicts: true to override.`,
        );
      } else if (!config.allowConflicts) {
        throw new Error(
          `File conflict: ${packageFile.relPath} already exists and is not managed by this package. Use allowConflicts: true to override.`,
        );
      } else {
        copyFile(packageFile.fullPath, destPath);
        changes.created.push(packageFile.relPath);
      }
    } else {
      copyFile(packageFile.fullPath, destPath);
      changes.created.push(packageFile.relPath);
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
    });
  }

  // Delete files that were managed by this package but are no longer in the package
  for (const [relPath, owner] of existingManagedMap) {
    if (owner.packageName !== config.packageName) continue;

    const stillPresent = Array.from(addedByDir.values())
      .flat()
      .some((m) => m.path === path.basename(relPath));

    if (!stillPresent) {
      const fullPath = path.join(config.outputDir, relPath);
      if (fs.existsSync(fullPath)) {
        removeFile(fullPath);
        changes.deleted.push(relPath);
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
    let existingMarker: FolderPublisherMarker | null = null;
    if (fs.existsSync(markerPath)) {
      existingMarker = readJsonFile<FolderPublisherMarker>(markerPath);
    }

    // Keep entries from other packages, replace entries from this package
    const mergedFiles: ManagedFileMetadata[] = [
      ...(existingMarker?.managedFiles ?? []).filter((m) => m.packageName !== config.packageName),
      // eslint-disable-next-line unicorn/no-keyword-prefix
      ...newFiles,
    ];

    const marker: FolderPublisherMarker = { version: '1.0.0', managedFiles: mergedFiles };
    writeJsonFile(markerPath, marker);
    fs.chmodSync(markerPath, 0o444);
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

  return {
    created: changes.created.length,
    updated: changes.updated.length,
    deleted: changes.deleted.length,
    changes,
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
