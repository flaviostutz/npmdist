/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

import {
  ExtractionMap,
  OutputConfig,
  PackageConfig,
  ExecuteResult,
  ManagedFileMetadata,
} from '../types';
import { ensureDir } from '../utils';
import { applyContentReplacements } from '../package/content-replacements';

import { writeMarker, markerPath } from './markers';
import { addToGitignore } from './gitignore';

/**
 * Apply an ExtractionMap to disk:
 *  - Copy toAdd and toModify files from source to dest
 *  - Make managed files read-only (unless unmanaged mode)
 *  - Delete toDelete files
 *  - Update .npmdata marker file (unless dryRun or unmanaged)
 *  - Update .gitignore (unless dryRun, unmanaged, or gitignore=false)
 *
 * @param map         The ExtractionMap produced by diff().
 * @param outputDir   Absolute path to the output directory.
 * @param outputConfig OutputConfig controlling write behaviour.
 * @param pkg         PackageConfig for marker metadata.
 * @param pkgVersion  Installed package version for marker metadata.
 * @param existingMarker Existing managed file entries (for incremental update).
 * @param cwd         Working directory (kept for API compatibility).
 * @returns ExecuteResult with counts and list of newly created files for rollback.
 */
// eslint-disable-next-line complexity
export async function execute(
  map: ExtractionMap,
  outputDir: string,
  outputConfig: OutputConfig,
  pkg: PackageConfig,
  pkgVersion: string,
  existingMarker: ManagedFileMetadata[],

  _cwd?: string,
  verbose?: boolean,
): Promise<ExecuteResult> {
  const dryRun = outputConfig.dryRun ?? false;
  const unmanaged = outputConfig.unmanaged ?? false;
  const updateGitignore = outputConfig.gitignore !== false;

  const result: ExecuteResult = {
    newlyCreated: [],
    added: 0,
    modified: 0,
    deleted: 0,
    skipped: map.toSkip.length,
  };

  // Write toAdd files
  for (const op of map.toAdd) {
    if (verbose) {
      console.log(`[verbose] execute: adding file ${op.destPath}`);
    }
    if (!dryRun) {
      ensureDir(path.dirname(op.destPath));
      // Make writable if it exists (should be rare for toAdd, but defensive)
      if (fs.existsSync(op.destPath)) {
        fs.chmodSync(op.destPath, 0o644);
      }
      fs.copyFileSync(op.sourcePath, op.destPath);
      if (!unmanaged) {
        fs.chmodSync(op.destPath, 0o444); // read-only
      }
      result.newlyCreated.push(op.destPath);
    }
    result.added += 1;
  }

  // Write toModify files
  for (const op of map.toModify) {
    if (verbose) {
      console.log(`[verbose] execute: modifying file ${op.destPath}`);
    }
    if (!dryRun) {
      ensureDir(path.dirname(op.destPath));
      if (fs.existsSync(op.destPath)) {
        fs.chmodSync(op.destPath, 0o644); // make writable before overwriting
      }
      fs.copyFileSync(op.sourcePath, op.destPath);
      if (!unmanaged) {
        fs.chmodSync(op.destPath, 0o444); // read-only
      }
    }
    result.modified += 1;
  }

  // Deletions are deferred: action-extract performs them after all filesets are
  // processed and counts them independently via deferredDeletes.length.
  // ExecuteResult.deleted is intentionally left at 0 here to avoid double-counting.
  // result.deleted = 0; (already initialised to 0 above)

  // Update marker and gitignore
  if (!dryRun && !unmanaged) {
    const marker = markerPath(outputDir);
    // Add newly extracted files to marker
    const addedPaths = new Set([
      ...map.toAdd.map((op) => op.relPath),
      ...map.toModify.map((op) => op.relPath),
    ]);

    // Remove deleted paths, add/update new paths
    const updatedEntries: ManagedFileMetadata[] = existingMarker.filter(
      (m) => !map.toDelete.includes(m.path) && !addedPaths.has(m.path),
    );

    for (const op of [...map.toAdd, ...map.toModify]) {
      updatedEntries.push({
        path: op.relPath,
        packageName: pkg.name,
        packageVersion: pkgVersion,
      });
    }

    if (verbose) {
      console.log(
        `[verbose] execute: writing marker file at ${marker} (${updatedEntries.length} entries)`,
      );
    }
    await writeMarker(marker, updatedEntries);

    if (updateGitignore) {
      const managedPaths = updatedEntries.map((m) => m.path);
      if (verbose) {
        console.log(
          `[verbose] execute: updating .gitignore at ${outputDir} (${managedPaths.length} paths)`,
        );
      }
      await addToGitignore(outputDir, managedPaths);
    }
  }

  // Apply content replacements
  if (!dryRun && outputConfig.contentReplacements && outputConfig.contentReplacements.length > 0) {
    if (verbose) {
      console.log(
        `[verbose] execute: applying ${outputConfig.contentReplacements.length} content replacement(s) in ${outputDir}`,
      );
    }
    await applyContentReplacements(outputDir, outputConfig.contentReplacements);
  }

  return result;
}

/**
 * Delete a list of files from disk and make them writable first.
 * Used for deferred deletions after all filesets have been processed.
 */
export async function deleteFiles(filePaths: string[], verbose?: boolean): Promise<void> {
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) continue;
    if (verbose) {
      console.log(`[verbose] execute: deleting file ${filePath}`);
    }
    try {
      fs.chmodSync(filePath, 0o644);
      fs.unlinkSync(filePath);
    } catch (error) {
      // Ignore errors for files that could not be deleted
      if (verbose) {
        console.error(`[verbose] execute: failed to delete ${filePath}: ${error}`);
      }
    }
  }
}

/**
 * Rollback: delete newly created files (those that did not exist before this run).
 */
export async function rollback(newlyCreated: string[]): Promise<void> {
  await deleteFiles(newlyCreated);
}
