import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  SelectorConfig,
  OutputConfig,
  ExtractionMap,
  ManagedFileMetadata,
  ContentReplacementConfig,
} from '../types';
import { hashFile } from '../utils';
import { applyContentReplacementsToBuffer } from '../package/content-replacements';

import { enumeratePackageFiles } from './package-files';

/**
 * Pure read-only diff between package source files and an output directory.
 * Classifies each file as toAdd, toModify, toDelete, toSkip, or conflicts.
 * Makes NO disk writes.
 *
 * @param pkgPath       Absolute path to the installed package directory.
 * @param outputDir     Absolute path to the output directory.
 * @param selector      SelectorConfig controlling which package files are included.
 * @param outputConfig  OutputConfig controlling extraction behaviour.
 * @param existingMarker Current managed file entries from the .npmdata marker.
 * @param contentReplacements Content replacement configs to apply before hash comparison.
 * @returns ExtractionMap classifying all file operations.
 */
export async function diff(
  pkgPath: string,
  outputDir: string,
  selector: SelectorConfig,
  outputConfig: OutputConfig,
  existingMarker: ManagedFileMetadata[],
  contentReplacements: ContentReplacementConfig[],
): Promise<ExtractionMap> {
  const result: ExtractionMap = {
    toAdd: [],
    toModify: [],
    toDelete: [],
    toSkip: [],
    conflicts: [],
  };

  // Build map of existing managed files by relPath -> metadata
  const managedByPath = new Map<string, ManagedFileMetadata>(
    existingMarker.map((m) => [m.path, m]),
  );

  // Enumerate files from package
  const pkgFiles = await enumeratePackageFiles(pkgPath, selector);
  const pkgFileSet = new Set(pkgFiles);

  for (const relPath of pkgFiles) {
    const srcPath = path.join(pkgPath, relPath);
    const destPath = path.join(outputDir, relPath);
    const destExists = fs.existsSync(destPath);
    const isManaged = managedByPath.has(relPath);

    if (outputConfig.unmanaged) {
      if (destExists) {
        result.toSkip.push({ relPath, reason: 'unmanaged' });
      } else {
        // In unmanaged mode, new files are still added (without marker)

        const srcHash = await hashFile(srcPath);
        result.toAdd.push({ relPath, sourcePath: srcPath, destPath, hash: srcHash });
      }
      continue;
    }

    if (outputConfig.keepExisting && destExists) {
      result.toSkip.push({ relPath, reason: 'keep-existing' });
      continue;
    }

    if (!destExists) {
      const srcHash = await hashFile(srcPath);
      result.toAdd.push({ relPath, sourcePath: srcPath, destPath, hash: srcHash });
      continue;
    }

    // Dest exists
    if (!isManaged) {
      // File exists but not in marker — it's unmanaged/foreign
      if (outputConfig.force) {
        // Override: treat as toModify

        const srcHash = await hashSrcWithReplacements(srcPath, contentReplacements);
        result.toModify.push({ relPath, sourcePath: srcPath, destPath, hash: srcHash });
      } else {
        result.conflicts.push({ relPath });
      }
      continue;
    }

    // Managed file — compare hashes
    const srcContent = fs.readFileSync(srcPath);
    const transformedContent = applyContentReplacementsToBuffer(
      srcContent.toString(),
      contentReplacements,
    );
    const srcHash = hashBuffer(transformedContent);

    const destHash = await hashFile(destPath);

    if (srcHash === destHash) {
      result.toSkip.push({ relPath, reason: 'keep-existing' });
    } else {
      result.toModify.push({ relPath, sourcePath: srcPath, destPath, hash: srcHash });
    }
  }

  // Find managed files that are no longer in the filtered package source.
  // Skip for unmanaged sets: they must not delete files managed by other sets
  // (unmanaged sets only add missing files and never take ownership of the marker).
  if (!outputConfig.unmanaged) {
    for (const managed of existingMarker) {
      if (!pkgFileSet.has(managed.path)) {
        result.toDelete.push(managed.path);
      }
    }
  }

  return result;
}

async function hashSrcWithReplacements(
  srcPath: string,
  contentReplacements: ContentReplacementConfig[],
): Promise<string> {
  if (contentReplacements.length === 0) return hashFile(srcPath);
  const content = fs.readFileSync(srcPath, 'utf8');
  const transformed = applyContentReplacementsToBuffer(content, contentReplacements);
  return hashString(transformed);
}

function hashString(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hashBuffer(content: string): string {
  return hashString(content);
}
