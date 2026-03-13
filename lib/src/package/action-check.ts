/* eslint-disable no-console */

import fs from 'node:fs';
import path from 'node:path';

import { NpmdataExtractEntry, ProgressEvent } from '../types';
import {
  parsePackageSpec,
  getInstalledPackagePath,
  getInstalledIfSatisfies,
  filterEntriesByPresets,
} from '../utils';
import { readOutputDirMarker } from '../fileset/markers';
import { checkFileset } from '../fileset/check';

export type CheckOptions = {
  entries: NpmdataExtractEntry[];
  cwd: string;
  presets?: string[];
  verbose?: boolean;
  onProgress?: (event: ProgressEvent) => void;
  skipUnmanaged?: boolean;
  visitedPackages?: Set<string>;
};

export type CheckSummary = {
  missing: string[];
  modified: string[];
  extra: string[];
};

/**
 * Orchestrate check across all filesets, filtering out unmanaged entries.
 * Returns a summary of all drift found across all entries.
 */
// eslint-disable-next-line complexity
export async function actionCheck(options: CheckOptions): Promise<CheckSummary> {
  const {
    entries,
    cwd,
    presets = [],
    verbose = false,
    onProgress,
    visitedPackages = new Set<string>(),
  } = options;
  const summary: CheckSummary = { missing: [], modified: [], extra: [] };

  // Filter by presets (same behaviour as purge)
  const filtered = filterEntriesByPresets(entries, presets);

  if (verbose) {
    console.log(
      `[verbose] check: verifying ${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'} (cwd: ${cwd})`,
    );
  }

  for (const entry of filtered) {
    // Skip unmanaged entries — they write no marker so there is nothing to check.
    // The --unmanaged flag also suppresses checking for explicitly marked entries.
    if (entry.output?.unmanaged) continue;

    const pkg = parsePackageSpec(entry.package);
    const outputDir = path.resolve(cwd, entry.output?.path ?? '.');

    if (verbose) {
      console.log(
        `[verbose] check: checking package=${entry.package} outputDir=${entry.output?.path ?? '.'}`,
      );
    }

    onProgress?.({
      type: 'package-start',
      packageName: pkg.name,
      packageVersion: pkg.version ?? 'latest',
    });

    // Check if package is installed
    const pkgPath = getInstalledPackagePath(pkg.name, cwd);

    // Read existing marker and filter to entries owned by this package only.
    // Multiple packages may share the same outputDir; passing the full marker to
    // checkFileset would cause files owned by other packages to be checked against
    // the current package's source, producing false positives.
    const existingMarker = await readOutputDirMarker(outputDir);
    const pkgMarker = existingMarker.filter((m) => m.packageName === pkg.name);

    if (!pkgPath) {
      console.error(`Package ${pkg.name} is not installed. Run 'extract' first.`);
      summary.missing.push(...pkgMarker.map((m) => m.path));
      continue;
    }

    const result = await checkFileset(
      pkgPath,
      outputDir,
      entry.selector ?? {},
      entry.output ?? {},
      pkgMarker,
    );

    summary.missing.push(...result.missing);
    summary.modified.push(...result.modified);
    summary.extra.push(...result.extra);

    onProgress?.({
      type: 'package-end',
      packageName: pkg.name,
      packageVersion: pkg.version ?? 'latest',
    });

    // Hierarchical check: if the installed package declares npmdata.sets, recurse into them
    const installedPkgPath = getInstalledIfSatisfies(pkg.name, pkg.version, cwd);
    if (installedPkgPath) {
      let pkgNpmdataSets: NpmdataExtractEntry[] | undefined;
      try {
        const depPkgJson = JSON.parse(
          fs.readFileSync(path.join(installedPkgPath, 'package.json')).toString(),
        ) as { npmdata?: { sets?: NpmdataExtractEntry[] } };
        pkgNpmdataSets = depPkgJson.npmdata?.sets;
      } catch (error) {
        if (verbose) {
          console.warn(
            `[verbose] check: could not read npmdata.sets from ${pkg.name}/package.json: ${error}`,
          );
        }
      }

      if (pkgNpmdataSets && pkgNpmdataSets.length > 0) {
        const siblingNames = new Set(entries.map((e) => parsePackageSpec(e.package).name));
        const presetFilteredSets = filterEntriesByPresets(
          pkgNpmdataSets,
          entry.selector?.presets ?? [],
        );
        const filteredSets = presetFilteredSets.filter(
          (e) =>
            !siblingNames.has(parsePackageSpec(e.package).name) &&
            !visitedPackages.has(parsePackageSpec(e.package).name),
        );

        if (filteredSets.length > 0) {
          const visitedSet = new Set(visitedPackages);
          visitedSet.add(pkg.name);

          const outputConfig = entry.output ?? {};
          const inheritedEntries = filteredSets.map((depEntry) => {
            const { path: depPath, ...restOutput } = depEntry.output ?? {};
            return {
              ...depEntry,
              output: {
                ...restOutput,
                path: path.join(outputConfig.path ?? '.', depPath ?? '.'),
              },
            };
          });

          if (verbose) {
            console.log(
              `[verbose] check: recursing into ${filteredSets.length} transitive set(s) from ${pkg.name}`,
            );
          }

          const subResult = await actionCheck({
            entries: inheritedEntries,
            cwd,
            presets,
            verbose,
            onProgress,
            visitedPackages: visitedSet,
          });
          summary.missing.push(...subResult.missing);
          summary.modified.push(...subResult.modified);
          summary.extra.push(...subResult.extra);
        }
      }
    }
  }

  return summary;
}
