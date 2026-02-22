import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  ConsumerConfig,
  ConsumerResult,
  CheckResult,
  FolderPublisherMarker,
  ManagedFileMetadata,
} from './types';
import {
  findMatchingFiles,
  ensureDir,
  removeFile,
  copyFile,
  getFileHash,
  matchesFilenamePattern,
  matchesContentRegex,
  detectPackageManager,
  getInstalledPackageVersion,
  validateSemverMatch,
  readJsonFile,
  writeJsonFile,
  runCommand,
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
    const version = await this.ensurePackageInstalled();

    // Extract files from package
    const changes = await this.extractPackageFiles(version);

    // Update markers
    await this.updateMarkers(version);

    const result: ConsumerResult = {
      created: changes.created.length,
      updated: changes.updated.length,
      deleted: changes.deleted.length,
      changes,
      package: {
        name: this.config.packageName,
        version,
      },
    };

    return result;
  }

  /**
   * Check if managed files are in sync
   */
  public async check(): Promise<CheckResult> {
    const version = await this.getPackageVersion();

    if (!version) {
      throw new Error(`Package ${this.config.packageName} is not installed. Run extract first.`);
    }

    // Load all managed files
    const allManaged = this.loadAllManagedFiles();

    const differences = {
      missing: [] as string[],
      extra: [] as string[],
      modified: [] as string[],
    };

    // Filter to only files from this package
    const thisPkgFiles = allManaged.filter((m) => m.packageName === this.config.packageName);

    // Get package files and build hash map
    const packageContents = await this.getPackageContents(version);
    const packageHashMap = new Map<string, string>();
    for (const content of packageContents) {
      packageHashMap.set(content.path, getFileHash(content.fullPath));
    }

    // Check each managed file from this package
    for (const metadata of thisPkgFiles) {
      const fullPath = path.join(this.config.outputDir, metadata.path);

      if (!fs.existsSync(fullPath)) {
        differences.missing.push(metadata.path);
      } else {
        const currentHash = getFileHash(fullPath);
        const packageHash = packageHashMap.get(metadata.path);
        if (packageHash && currentHash !== packageHash) {
          differences.modified.push(metadata.path);
        }
      }
    }

    // Get currently available files in package
    const packageFiles = await this.getPackageFilesList(version);

    // Check for files that are in package but not managed by this package
    for (const pkgFile of packageFiles) {
      const isManagedByThisPackage = thisPkgFiles.some((m) => m.path === pkgFile);
      if (!isManagedByThisPackage && fs.existsSync(path.join(this.config.outputDir, pkgFile))) {
        differences.extra.push(pkgFile);
      }
    }

    return {
      ok:
        differences.missing.length === 0 &&
        differences.modified.length === 0 &&
        differences.extra.length === 0,
      differences,
      package: {
        name: this.config.packageName,
        version,
      },
    };
  }

  /**
   * Ensure package is installed
   */
  private async ensurePackageInstalled(): Promise<string> {
    const installed = getInstalledPackageVersion(this.config.packageName, this.packageManager);

    if (!installed) {
      // Install the package
      await this.installPackage();
    } else {
      // Verify version if specified
      if (this.config.version && !validateSemverMatch(installed, this.config.version)) {
        throw new Error(
          `Installed version ${installed} does not match constraint ${this.config.version}`,
        );
      }
    }

    return getInstalledPackageVersion(this.config.packageName, this.packageManager)!;
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
    runCommand(cmd);
  }

  /**
   * Extract files from the installed package
   */
  private async extractPackageFiles(version: string): Promise<ConsumerResult['changes']> {
    const changes: ConsumerResult['changes'] = {
      created: [],
      updated: [],
      deleted: [],
    };

    // Get package contents
    const packageContents = await this.getPackageContents(version);
    const newManagedFiles: Map<string, ManagedFileMetadata[]> = new Map();

    // Load existing managed files per directory
    const existingByPath = this.loadAllManagedFilesMap();

    // Extract new files from package
    for (const srcFile of packageContents) {
      const relPath = path.normalize(srcFile.path);

      // Check if file should be included based on filters
      if (
        !matchesFilenamePattern(relPath, this.config.filenamePattern) ||
        !matchesContentRegex(srcFile.fullPath, this.config.contentRegex)
      ) {
        continue;
      }

      const metadata: ManagedFileMetadata = {
        path: relPath,
        packageName: this.config.packageName,
        packageVersion: version,
      };

      const fullPath = path.join(this.config.outputDir, relPath);
      ensureDir(path.dirname(fullPath));

      // Check for conflicts
      const existingOwner = existingByPath.get(relPath);
      if (fs.existsSync(fullPath)) {
        if (existingOwner && existingOwner.packageName === this.config.packageName) {
          // Update existing managed file from same package
          copyFile(srcFile.fullPath, fullPath);
          changes.updated.push(relPath);
        } else if (existingOwner && existingOwner.packageName !== this.config.packageName) {
          // File owned by different package - this is a package clash
          throw new Error(
            `Package clash: ${relPath} already managed by ${existingOwner.packageName}@${existingOwner.packageVersion}. Cannot extract from ${this.config.packageName}. Use allowConflicts: true to override.`,
          );
        } else if (!this.config.allowConflicts) {
          throw new Error(
            `File conflict: ${relPath} already exists and is not managed by this package. Use allowConflicts: true to override.`,
          );
        } else {
          // Overwrite with allowConflicts
          copyFile(srcFile.fullPath, fullPath);
          changes.created.push(relPath);
        }
      } else {
        copyFile(srcFile.fullPath, fullPath);
        changes.created.push(relPath);
      }

      // Make file read-only
      fs.chmodSync(fullPath, 0o444);

      // Store by directory - store filename with package metadata
      const dir = path.dirname(relPath) || '.';
      const justFileName = path.basename(relPath);
      if (!newManagedFiles.has(dir)) {
        newManagedFiles.set(dir, []);
      }
      newManagedFiles.get(dir)!.push({
        path: justFileName,
        packageName: this.config.packageName,
        packageVersion: version,
      });
    }

    // Delete files that were managed but no longer exist in package
    for (const [existingPath, existingOwner] of existingByPath) {
      if (existingOwner.packageName === this.config.packageName) {
        const isInNewFiles = Array.from(newManagedFiles.values()).some((files) =>
          files.some((m) => m.path === path.basename(existingPath)),
        );

        if (!isInNewFiles) {
          const fullPath = path.join(this.config.outputDir, existingPath);
          if (fs.existsSync(fullPath)) {
            removeFile(fullPath);
            changes.deleted.push(existingPath);
          }
        }
      }
    }

    // Update marker files
    for (const [dir, files] of newManagedFiles) {
      const markerDir = dir === '.' ? this.config.outputDir : path.join(this.config.outputDir, dir);
      ensureDir(markerDir);
      const markerPath = path.join(markerDir, MARKER_FILE);

      // Load existing marker to preserve files from other packages
      let existingMarker: FolderPublisherMarker | null = null;
      if (fs.existsSync(markerPath)) {
        try {
          existingMarker = readJsonFile<FolderPublisherMarker>(markerPath);
        } catch {
          // Ignore errors reading existing marker
        }
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
        updated: Date.now(),
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
    const walkDir = (dir: string) => {
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
  private loadAllManagedFilesMap(): Map<string, ManagedFileMetadata> {
    const files = new Map<string, ManagedFileMetadata>();
    const baseDir = this.config.outputDir;

    const walkDir = (dir: string) => {
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

    const walkDir = (dir: string) => {
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
   * Get list of files in package
   */
  private async getPackageFilesList(version: string): Promise<string[]> {
    const contents = await this.getPackageContents(version);
    return contents.map((c) => c.path);
  }

  /**
   * Get package contents (list of files)
   */
  private async getPackageContents(
    version: string,
  ): Promise<Array<{ path: string; fullPath: string }>> {
    const packagePath = this.getInstalledPackagePath(version);

    if (!packagePath) {
      throw new Error(`Cannot locate installed package: ${this.config.packageName}`);
    }

    const contents: Array<{ path: string; fullPath: string }> = [];
    const walkDir = (dir: string, basePath = '') => {
      const files = fs.readdirSync(dir);

      for (const file of files) {
        if (file === MARKER_FILE || file.startsWith('.')) continue;

        const fullPath = path.join(dir, file);
        const relPath = basePath ? `${basePath}/${file}` : file;
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          walkDir(fullPath, relPath);
        } else {
          contents.push({ path: relPath, fullPath });
        }
      }
    };

    walkDir(packagePath);
    return contents;
  }

  /**
   * Get installed package path
   */
  private getInstalledPackagePath(version: string): string | null {
    try {
      const pkgPath = require.resolve(`${this.config.packageName}/package.json`);
      return path.dirname(pkgPath);
    } catch {
      return null;
    }
  }

  /**
   * Get package version
   */
  private async getPackageVersion(): Promise<string | null> {
    return getInstalledPackageVersion(this.config.packageName, this.packageManager);
  }

  /**
   * Update markers after extraction
   */
  private async updateMarkers(version: string): Promise<void> {
    // This is called after extractPackageFiles which already updated markers
    // Clean up any empty markers
    this.cleanupMarkers();
  }
}
