/* eslint-disable no-console */

import fs from 'node:fs';
import path from 'node:path';

import { NpmdataExtractEntry, ProgressEvent, SelectorConfig, OutputConfig } from '../types';
import {
  parsePackageSpec,
  installOrUpgradePackage,
  getInstalledIfSatisfies,
  cleanupTempPackageJson,
  filterEntriesByPresets,
} from '../utils';
import { diff } from '../fileset/diff';
import { execute, rollback, deleteFiles } from '../fileset/execute';
import { readOutputDirMarker } from '../fileset/markers';

import { createSymlinks, removeStaleSymlinks } from './symlinks';

export type ExtractOptions = {
  entries: NpmdataExtractEntry[];
  cwd: string;
  verbose?: boolean;
  onProgress?: (event: ProgressEvent) => void;
  visitedPackages?: Set<string>;
};

export type ExtractResult = {
  added: number;
  modified: number;
  deleted: number;
  skipped: number;
};

/**
 * Orchestrate full extract across all filesets.
 * Implements the two-phase diff+execute model with conflict detection and rollback.
 */
// eslint-disable-next-line complexity
export async function actionExtract(options: ExtractOptions): Promise<ExtractResult> {
  const { entries, cwd, verbose, onProgress, visitedPackages = new Set<string>() } = options;

  if (verbose) {
    console.log(
      `[verbose] >>> EXTRACT - ${entries.reduce((acc, entry) => acc + entry.package + ', ', '').slice(0, -2)}`,
    );
  }

  const result: ExtractResult = { added: 0, modified: 0, deleted: 0, skipped: 0 };
  const allNewlyCreated: string[] = [];
  const deferredDeletes: string[] = [];

  try {
    for (const entry of entries) {
      if (verbose) {
        // eslint-disable-next-line no-undefined
        console.log(`[verbose] config: ${JSON.stringify(entry, undefined, 2)}`);
      }

      if (!entry.package) {
        throw new Error('Each set entry must have a "package" field.');
      }
      const pkg = parsePackageSpec(entry.package);

      // Circular dependency detection
      if (visitedPackages.has(pkg.name)) {
        throw new Error(
          `Circular dependency detected: package "${pkg.name}" is already being extracted`,
        );
      }

      const outputDir = path.resolve(cwd, entry.output?.path ?? '.');
      const selector: SelectorConfig = entry.selector ?? {};
      const outputConfig: OutputConfig = entry.output ?? {};
      const contentReplacements = outputConfig.contentReplacements ?? [];

      onProgress?.({
        type: 'package-start',
        packageName: pkg.name,
        packageVersion: pkg.version ?? 'latest',
      });

      if (verbose) {
        console.log(
          `[verbose] extract: entry package=${entry.package} outputDir=${entry.output?.path ?? '.'}`,
        );
      }

      // Phase 1: Install package
      const upgrade = selector.upgrade ?? false;
      const alreadyCached =
        !upgrade && getInstalledIfSatisfies(pkg.name, pkg.version, cwd) !== null;
      const pkgPath = await installOrUpgradePackage(pkg.name, pkg.version, upgrade, cwd, verbose);

      if (verbose) {
        let action = 'installed';
        if (alreadyCached) action = 'using cached';
        else if (upgrade) action = 'upgraded';
        console.log(`[verbose] extract: ${action} package ${pkg.name} at ${pkgPath}`);
      }

      // Get installed version
      let installedVersion = '0.0.0';
      try {
        const pkgJsonContent = JSON.parse(
          fs.readFileSync(path.join(pkgPath, 'package.json')).toString(),
        ) as {
          version: string;
        };
        installedVersion = pkgJsonContent.version;
      } catch (error) {
        // fallback
        if (verbose) {
          console.warn(
            `[verbose] extract: could not read version from ${pkg.name}/package.json, defaulting to 0.0.0: ${error}`,
          );
        }
      }

      // Remove stale symlinks before diff
      if (outputConfig.symlinks && outputConfig.symlinks.length > 0) {
        await removeStaleSymlinks(outputDir, outputConfig.symlinks);
      }

      // Phase 2: Read existing marker (all packages combined)

      const existingMarker = await readOutputDirMarker(outputDir);

      // Filter to current package only so diff's toDelete logic doesn't purge
      // files managed by other packages writing to the same output directory.
      const pkgMarker = existingMarker.filter((m) => m.packageName === pkg.name);

      // Phase 3: Diff phase (pure, no disk writes)

      const extractionMap = await diff(
        pkgPath,
        outputDir,
        selector,
        outputConfig,
        pkgMarker,
        contentReplacements,
      );

      // Phase 4: Abort on conflicts (unless force or unmanaged)
      if (extractionMap.conflicts.length > 0 && !outputConfig.force && !outputConfig.unmanaged) {
        const conflictPaths = extractionMap.conflicts.map((c) => c.relPath).join('\n');
        if (verbose) {
          console.warn(
            `[verbose] extract: aborting due to ${extractionMap.conflicts.length} conflict(s) in ${outputDir}: ${conflictPaths}`,
          );
        }
        throw new Error(
          `Conflict: the following files exist and are not managed by npmdata:\n${conflictPaths}\n` +
            `Use --force to overwrite or --unmanaged to skip.`,
        );
      }

      // Phase 5: Execute phase (disk writes)

      if (verbose) {
        console.log(
          `[verbose] extract: diff result for ${pkg.name}: +${extractionMap.toAdd.length} ~${extractionMap.toModify.length} -${extractionMap.toDelete.length} skip=${extractionMap.toSkip.length} conflicts=${extractionMap.conflicts.length}`,
        );
        console.log(`[verbose] extract: executing disk writes for ${pkg.name} in ${outputDir}`);
      }

      const executeResult = await execute(
        extractionMap,
        outputDir,
        outputConfig,
        pkg,
        installedVersion,
        existingMarker,
        cwd,
        verbose,
      );

      // Collect newly created files for potential rollback
      allNewlyCreated.push(...executeResult.newlyCreated);

      // Collect deferred deletes (execute across all filesets first)
      for (const relPath of extractionMap.toDelete) {
        deferredDeletes.push(path.join(outputDir, relPath));
      }

      // Emit progress events
      for (const op of extractionMap.toAdd) {
        onProgress?.({ type: 'file-added', packageName: pkg.name, file: op.relPath });
      }
      for (const op of extractionMap.toModify) {
        onProgress?.({ type: 'file-modified', packageName: pkg.name, file: op.relPath });
      }
      for (const relPath of extractionMap.toDelete) {
        onProgress?.({ type: 'file-deleted', packageName: pkg.name, file: relPath });
      }
      for (const skipped of extractionMap.toSkip) {
        onProgress?.({ type: 'file-skipped', packageName: pkg.name, file: skipped.relPath });
      }

      result.added += executeResult.added;
      result.modified += executeResult.modified;
      result.skipped += executeResult.skipped;

      // Handle recursive resolution: check if installed package has npmdata.sets
      let pkgNpmdataSets: NpmdataExtractEntry[] | undefined;
      try {
        const depPkgJson = JSON.parse(
          fs.readFileSync(path.join(pkgPath, 'package.json')).toString(),
        ) as {
          npmdata?: { sets?: NpmdataExtractEntry[] };
        };
        pkgNpmdataSets = depPkgJson.npmdata?.sets;
      } catch (error) {
        // No package.json or no npmdata.sets
        if (verbose) {
          console.warn(
            `[verbose] extract: could not read npmdata.sets from ${pkg.name}/package.json: ${error}`,
          );
        }
      }

      if (pkgNpmdataSets && pkgNpmdataSets.length > 0) {
        // Names of packages already being processed at this level (siblings).
        // Skip recursive resolution for any set entry that is already a sibling — those
        // will be (or have been) handled by the outer loop. This prevents self-referencing
        // npmdata.sets from triggering the circular-dependency guard.
        const siblingNames = new Set(entries.map((e) => parsePackageSpec(e.package).name));

        // Apply selector.presets: filter the target package's own sets by the preset tags
        // requested by the consumer. When selector.presets is empty, all sets pass through.
        const presetFilteredSets = filterEntriesByPresets(pkgNpmdataSets, selector.presets ?? []);

        if ((selector.presets ?? []).length > 0 && presetFilteredSets.length === 0) {
          throw new Error(
            `Preset selector [${(selector.presets ?? []).join(', ')}] did not match any sets in package "${pkg.name}". Available presets: [${[...new Set(pkgNpmdataSets.flatMap((s) => s.presets ?? []))].sort().join(', ')}]`,
          );
        }

        const filteredSets = presetFilteredSets.filter(
          (e) =>
            !siblingNames.has(parsePackageSpec(e.package).name) &&
            !visitedPackages.has(parsePackageSpec(e.package).name),
        );

        if (filteredSets.length > 0) {
          const visitedSet = new Set(visitedPackages);
          visitedSet.add(pkg.name);

          // Inherit caller overrides (force, dryRun, keepExisting, gitignore, unmanaged) from current entry.
          // Caller-defined (non-undefined) values always take precedence; undefined propagates as-is
          // so defaults are only resolved at the leaf execute() level, not during recursion.
          const inheritedEntries = filteredSets.map((depEntry) => {
            const { path: depPath, ...restOutput } = depEntry.output ?? {};
            const inheritedOutput = {
              ...restOutput,
              path: path.join(outputConfig.path ?? '.', depPath ?? '.'),
              force: outputConfig.force ?? restOutput.force,
              dryRun: outputConfig.dryRun ?? restOutput.dryRun,
              keepExisting: outputConfig.keepExisting ?? restOutput.keepExisting,
              gitignore: outputConfig.gitignore ?? restOutput.gitignore,
              unmanaged: outputConfig.unmanaged ?? restOutput.unmanaged,
              // Append symlinks and contentReplacements
              symlinks: [...(outputConfig.symlinks ?? []), ...(restOutput.symlinks ?? [])],
              contentReplacements: [
                ...(outputConfig.contentReplacements ?? []),
                ...(restOutput.contentReplacements ?? []),
              ],
            };
            return {
              ...depEntry,
              output: inheritedOutput,
            };
          });

          if (verbose) {
            console.log(
              `[verbose] extract: recursing into ${filteredSets.length} transitive set(s) from ${pkg.name}`,
            );
          }
          const subResult = await actionExtract({
            entries: inheritedEntries,
            cwd,
            verbose,
            onProgress,
            visitedPackages: visitedSet,
          });
          result.added += subResult.added;
          result.modified += subResult.modified;
          result.deleted += subResult.deleted;
          result.skipped += subResult.skipped;
        }
      }

      // Create symlinks
      if (outputConfig.symlinks && outputConfig.symlinks.length > 0 && !outputConfig.dryRun) {
        await createSymlinks(outputDir, outputConfig.symlinks);
      }

      onProgress?.({
        type: 'package-end',
        packageName: pkg.name,
        packageVersion: installedVersion,
      });
    }

    // Deferred deletions: delete after all filesets have been processed
    if (verbose && deferredDeletes.length > 0) {
      console.log(`[verbose] extract: performing ${deferredDeletes.length} deferred deletion(s)`);
    }
    await deleteFiles(deferredDeletes, verbose);
    result.deleted += deferredDeletes.length;

    // cleanup temp package.json and node_module if was created just for this extraction
    cleanupTempPackageJson(cwd, verbose);
  } catch (error) {
    // Partial rollback: delete only newly created files
    if (verbose) {
      console.error(
        `[verbose] extract: error encountered, rolling back ${allNewlyCreated.length} newly created file(s): ${error}`,
      );
    }
    await rollback(allNewlyCreated);
    throw error;
  }

  return result;
}
