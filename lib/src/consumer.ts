/* eslint-disable functional/no-try-statements */
/* eslint-disable functional/no-let */
/* eslint-disable no-continue */
/* eslint-disable functional/immutable-data */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-console */
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

/**
 * Consumer utility for extracting files from published packages
 */
export class Consumer {
  private readonly config: ConsumerConfig;

  private readonly packageManager: 'npm' | 'yarn' | 'pnpm';

  private readonly markersByDir = new Map<string, FolderPublisherMarker>();

  constructor(config: ConsumerConfig) {
    this.config = config;
    this.packageManager = config.packageManager || detectPackageManager();

    ensureDir(this.config.outputDir);
  }

  /**
   * Extract files from package to output directory
   */
  public async extract(): Promise<ConsumerResult> {
    // Install package if not present
    const installedVersion = await this.ensurePackageInstalled();
    console.info(
      `Extracting files from package ${this.config.packageName}@${installedVersion} (package manager: ${this.packageManager})`,
    );

    // Extract files from package
    const changes = await this.extractPackageFiles();

    // Cleanup any empty markers (e.g., from deleted files)
    this.cleanupMarkers();

    const result: ConsumerResult = {
      created: changes.created.length,
      updated: changes.updated.length,
      deleted: changes.deleted.length,
      changes,
      sourcePackage: {
        name: this.config.packageName,
        version: installedVersion,
      },
    };

    return result;
  }

  /**
   * Check if managed files are in sync
   */
  public async check(): Promise<CheckResult> {
    const installedVersion = getInstalledPackageVersion(this.config.packageName, this.config.cwd);

    if (!installedVersion) {
      throw new Error(`Package ${this.config.packageName} is not installed. Install it first.`);
    }

    // Load all managed files
    const allManagedFiles = this.loadAllManagedFiles();

    const differences = {
      missing: [] as string[],
      extra: [] as string[],
      modified: [] as string[],
    };

    // Filter to only files from this package
    const managedFiles = allManagedFiles.filter((m) => m.packageName === this.config.packageName);

    // Get package files and build hash map
    const packageFilePaths = await this.getPackageFiles();
    const packageHashMap = new Map<string, string>();
    for (const packageFilePath of packageFilePaths) {
      packageHashMap.set(packageFilePath.relPath, calculateFileHash(packageFilePath.fullPath));
    }

    // Check each managed file from this package
    for (const managedFile of managedFiles) {
      const managedFileFullPath = path.join(this.config.outputDir, managedFile.path);

      // missing file: managed by this package but not found locally
      if (!fs.existsSync(managedFileFullPath)) {
        differences.missing.push(managedFile.path);
        continue;
      }

      const managedFileHash = calculateFileHash(managedFileFullPath);
      const packageFileHash = packageHashMap.get(managedFile.path);
      if (packageFileHash && managedFileHash !== packageFileHash) {
        differences.modified.push(managedFile.path);
      }
    }

    // Check for files that are in package but not managed by this package
    for (const pkgFile of packageFilePaths) {
      const isManagedByThisPackage = managedFiles.some((m) => m.path === pkgFile.relPath);
      if (
        !isManagedByThisPackage &&
        fs.existsSync(path.join(this.config.outputDir, pkgFile.relPath))
      ) {
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
        name: this.config.packageName,
        version: installedVersion,
      },
    };
  }

  /**
   * Ensure package is installed
   */
  private async ensurePackageInstalled(): Promise<string> {
    const existingVersion = getInstalledPackageVersion(this.config.packageName, this.config.cwd);

    if (!existingVersion) {
      // Install the package
      await this.installPackage();
    }

    // Verify version if specified
    const installedVersion = getInstalledPackageVersion(this.config.packageName, this.config.cwd);
    if (!installedVersion) {
      throw new Error(`Couldn't find package ${this.config.packageName}`);
    }
    if (this.config.version && !satisfies(installedVersion, this.config.version)) {
      throw new Error(
        `Installed version ${installedVersion} of package '${this.config.packageName}' does not match constraint ${this.config.version}`,
      );
    }

    return installedVersion;
  }

  /**
   * Install package from registry
   */
  private async installPackage(): Promise<void> {
    const packageSpec = this.config.version
      ? `${this.config.packageName}@${this.config.version}`
      : this.config.packageName;

    let cmd: string;
    switch (this.packageManager) {
      case 'pnpm':
        cmd = `pnpm add ${packageSpec}`;
        break;
      case 'yarn':
        cmd = `yarn add ${packageSpec}`;
        break;
      default:
        cmd = `npm install ${packageSpec}`;
    }

    console.log(`Installing ${packageSpec}...`);
    execSync(cmd, { encoding: 'utf8', stdio: 'pipe', cwd: this.config.cwd });
  }

  /**
   * Extract files from the installed package
   */
  // eslint-disable-next-line complexity
  private async extractPackageFiles(): Promise<ConsumerResult['changes']> {
    const changes: ConsumerResult['changes'] = {
      created: [],
      updated: [],
      deleted: [],
    };

    // Get package contents
    const installedPackageVersion = getInstalledPackageVersion(
      this.config.packageName,
      this.config.cwd,
    );
    if (!installedPackageVersion) {
      throw new Error(
        `Failed to determine installed version of package ${this.config.packageName}`,
      );
    }
    const packageFiles = await this.getPackageFiles();
    const addedManagedFiles: Map<string, ManagedFileMetadata[]> = new Map();

    // Load existing managed files per directory
    const existingManagedFilesMap = this.loadExistingManagedFilesMap();

    // Extract new files from package
    for (const packageFile of packageFiles) {
      // Check if file should be included based on filters
      if (
        !matchesFilenamePattern(packageFile.relPath, this.config.filenamePatterns) ||
        !matchesContentRegex(packageFile.fullPath, this.config.contentRegexes)
      ) {
        continue;
      }

      const packageFileFullPath = path.join(this.config.outputDir, packageFile.relPath);
      ensureDir(path.dirname(packageFileFullPath));

      // Check for conflicts
      const existingOwner = existingManagedFilesMap.get(packageFile.relPath);
      if (fs.existsSync(packageFileFullPath)) {
        if (existingOwner && existingOwner.packageName === this.config.packageName) {
          // Update existing managed file from same package
          copyFile(packageFile.fullPath, packageFileFullPath);
          changes.updated.push(packageFile.relPath);
        } else if (existingOwner && existingOwner.packageName !== this.config.packageName) {
          // File owned by different package - this is a package clash
          throw new Error(
            `Package clash: ${packageFile.relPath} already managed by ${existingOwner.packageName}@${existingOwner.packageVersion}. Cannot extract from ${this.config.packageName}. Use allowConflicts: true to override.`,
          );
        } else if (!this.config.allowConflicts) {
          throw new Error(
            `File conflict: ${packageFile.relPath} already exists and is not managed by this package. Use allowConflicts: true to override.`,
          );
        } else {
          // Overwrite with allowConflicts
          copyFile(packageFile.fullPath, packageFileFullPath);
          changes.created.push(packageFile.relPath);
        }
      } else {
        copyFile(packageFile.fullPath, packageFileFullPath);
        changes.created.push(packageFile.relPath);
      }

      // Make file read-only
      fs.chmodSync(packageFileFullPath, 0o444);

      // Store by directory - store filename with package metadata
      const dir = path.dirname(packageFile.relPath) || '.';
      const packageFileBasename = path.basename(packageFile.relPath);
      if (!addedManagedFiles.has(dir)) {
        addedManagedFiles.set(dir, []);
      }
      addedManagedFiles.get(dir)!.push({
        path: packageFileBasename,
        packageName: this.config.packageName,
        packageVersion: installedPackageVersion,
      });
    }

    // Delete files that were managed but no longer exist in package
    for (const [existingManagedFilePath, existingManagedFileOwner] of existingManagedFilesMap) {
      if (existingManagedFileOwner.packageName === this.config.packageName) {
        const isInNewFiles = Array.from(addedManagedFiles.values()).some((files) =>
          files.some((m) => m.path === path.basename(existingManagedFilePath)),
        );

        if (!isInNewFiles) {
          const fullPath = path.join(this.config.outputDir, existingManagedFilePath);
          if (fs.existsSync(fullPath)) {
            removeFile(fullPath);
            changes.deleted.push(existingManagedFilePath);
          }
        }
      }
    }

    // Update marker files
    for (const [dir, files] of addedManagedFiles) {
      const markerDir = dir === '.' ? this.config.outputDir : path.join(this.config.outputDir, dir);
      ensureDir(markerDir);
      const markerPath = path.join(markerDir, MARKER_FILE);

      // Load existing marker to preserve files from other packages
      // eslint-disable-next-line unicorn/no-null
      let existingMarker: FolderPublisherMarker | null = null;
      if (fs.existsSync(markerPath)) {
        existingMarker = readJsonFile<FolderPublisherMarker>(markerPath);
      }

      // Merge files: keep files from other packages, replace files from this package
      const mergedManaged: ManagedFileMetadata[] = [];

      if (existingMarker?.managedFiles) {
        for (const existing of existingMarker.managedFiles) {
          // Keep files from other packages
          if (existing.packageName !== this.config.packageName) {
            mergedManaged.push(existing);
          }
        }
      }

      // Add all files from current package
      mergedManaged.push(...files);

      const marker: FolderPublisherMarker = {
        version: '1.0.0',
        managedFiles: mergedManaged,
      };
      writeJsonFile(markerPath, marker);
      fs.chmodSync(markerPath, 0o444);
    }

    this.cleanupMarkers();
    return changes;
  }

  /**
   * Clean up empty marker files
   */
  private cleanupMarkers(): void {
    const walkDir = (dir: string): void => {
      if (!fs.existsSync(dir)) return;

      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file === MARKER_FILE) {
          const markerPath = path.join(dir, file);
          try {
            const marker = readJsonFile<FolderPublisherMarker>(markerPath);
            // Only delete marker if it has no managed files
            if (!marker.managedFiles || marker.managedFiles.length === 0) {
              fs.chmodSync(markerPath, 0o644);
              fs.unlinkSync(markerPath);
            }
          } catch {
            // Ignore errors reading marker
          }
        } else {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory() && !file.startsWith('.')) {
            walkDir(fullPath);
          }
        }
      }
    };

    walkDir(this.config.outputDir);
  }

  /**
   * Load all managed files from markers (as Map with package ownership info)
   */
  private loadExistingManagedFilesMap(): Map<string, ManagedFileMetadata> {
    const files = new Map<string, ManagedFileMetadata>();
    const baseDir = this.config.outputDir;

    const walkDir = (dir: string): void => {
      if (!fs.existsSync(dir)) return;

      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (item === MARKER_FILE) {
          try {
            const marker = readJsonFile<FolderPublisherMarker>(fullPath);
            // Reconstruct full paths: marker is in a directory, and contains filenames
            const markerDir = path.dirname(fullPath);
            const relMarkerDir = path.relative(baseDir, markerDir);

            for (const managed of marker.managedFiles) {
              // The stored path in marker is just the filename
              const fullRelPath =
                relMarkerDir === '.' ? managed.path : path.join(relMarkerDir, managed.path);

              files.set(fullRelPath, managed);
            }
          } catch {
            // Ignore errors reading marker
          }
        } else if (stat.isDirectory() && !item.startsWith('.')) {
          walkDir(fullPath);
        }
      }
    };

    walkDir(baseDir);
    return files;
  }

  /**
   * Load all managed files from markers
   */
  private loadAllManagedFiles(): ManagedFileMetadata[] {
    const files: ManagedFileMetadata[] = [];
    const baseDir = this.config.outputDir;

    const walkDir = (dir: string): void => {
      if (!fs.existsSync(dir)) return;

      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (item === MARKER_FILE) {
          try {
            const marker = readJsonFile<FolderPublisherMarker>(fullPath);
            // Reconstruct full paths: marker is in a directory, and contains filenames
            const markerDir = path.dirname(fullPath);
            const relMarkerDir = path.relative(baseDir, markerDir);

            for (const managed of marker.managedFiles) {
              // The stored path in marker is just the filename
              const fullRelPath =
                relMarkerDir === '.' ? managed.path : path.join(relMarkerDir, managed.path);

              files.push({
                path: fullRelPath,
                packageName: managed.packageName,
                packageVersion: managed.packageVersion,
              });
            }
          } catch {
            // Ignore errors reading marker
          }
        } else if (stat.isDirectory() && !item.startsWith('.')) {
          walkDir(fullPath);
        }
      }
    };

    walkDir(baseDir);
    return files;
  }

  /**
   * Get package contents (list of files)
   */
  private async getPackageFiles(): Promise<Array<{ relPath: string; fullPath: string }>> {
    const packagePath = this.getInstalledPackagePath();

    if (!packagePath) {
      throw new Error(`Cannot locate installed package: ${this.config.packageName}`);
    }

    const contents: Array<{ relPath: string; fullPath: string }> = [];
    const walkDir = (dir: string, basePath = ''): void => {
      const files = fs.readdirSync(dir);

      for (const file of files) {
        if (file === MARKER_FILE) continue;

        const fullPath = path.join(dir, file);
        const relPath = basePath ? `${basePath}/${file}` : file;
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          walkDir(fullPath, relPath);
        } else {
          contents.push({ relPath, fullPath });
        }
      }
    };

    walkDir(packagePath);
    return contents;
  }

  /**
   * Get installed package path
   */
  private getInstalledPackagePath(): string | null {
    // eslint-disable-next-line functional/no-try-statements
    try {
      if (this.config.cwd) {
        const pkgPath = path.join(
          this.config.cwd,
          'node_modules',
          this.config.packageName,
          'package.json',
        );
        if (fs.existsSync(pkgPath)) {
          return path.dirname(pkgPath);
        }
      }
      const pkgPath = require.resolve(`${this.config.packageName}/package.json`);
      return path.dirname(pkgPath);
    } catch {
      // eslint-disable-next-line unicorn/no-null
      return null;
    }
  }
}
