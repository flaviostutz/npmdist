#!/usr/bin/env node
/* eslint-disable no-undefined */
/* eslint-disable functional/immutable-data */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-plusplus */
/* eslint-disable functional/no-let */
/* eslint-disable no-console */

import fs from 'node:fs';
import path from 'node:path';

import { cosmiconfig } from 'cosmiconfig';

import { extract, check, list, purge } from './consumer';
import { initPublisher } from './publisher';
import { runEntries } from './runner';
import { ConsumerConfig, NpmdataConfig, ProgressEvent } from './types';

/**
 * CLI for npmdata
 */
// eslint-disable-next-line complexity
export async function cli(processArgs: string[], cliPath?: string): Promise<number> {
  const args = processArgs.slice(2);

  // Handle global help and version flags before defaulting to extract
  if (args.length > 0 && (args[0] === '--help' || args[0] === '-h')) {
    printUsage();
    return 0;
  }

  if (args.length > 0 && args[0] === '--version') {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json')).toString());
    console.log(pkg.version);
    return 0;
  }

  // Default to 'extract' when no args are given or when the first arg is a flag
  let command: string;
  let argsOffset: number;
  if (args.length === 0 || args[0].startsWith('-')) {
    command = 'extract';
    argsOffset = 0;
  } else {
    command = args[0];
    argsOffset = 1;
  }

  // Handle init command
  if (command === 'init') {
    // eslint-disable-next-line functional/no-let
    let sourceFilesFlag: string | undefined;
    // eslint-disable-next-line functional/no-let
    let additionalPackagesFlag: string | undefined;
    // eslint-disable-next-line functional/no-let
    let initGitignore = true;
    // eslint-disable-next-line functional/no-let
    let initUnmanaged = false;
    // eslint-disable-next-line functional/no-let
    let initVerbose = false;

    // Parse args for --files and --packages flags
    // eslint-disable-next-line functional/no-let
    for (let i = 1; i < args.length; i += 1) {
      if (args[i] === '--files') {
        // eslint-disable-next-line no-plusplus
        sourceFilesFlag = args[++i];
      } else if (args[i] === '--packages') {
        // eslint-disable-next-line no-plusplus
        additionalPackagesFlag = args[++i];
      } else if (args[i] === '--no-gitignore') {
        initGitignore = false;
      } else if (args[i] === '--unmanaged') {
        initUnmanaged = true;
      } else if (args[i] === '--verbose' || args[i] === '-v') {
        initVerbose = true;
      }
    }

    // --files is required
    if (!sourceFilesFlag) {
      console.error('Error: --files option is required for init command');
      printUsage();
      return 1;
    }

    const fileGlobs = sourceFilesFlag.split(',').map((f) => f.trim());
    const additionalPackages = additionalPackagesFlag
      ? additionalPackagesFlag.split(',').map((p) => p.trim())
      : [];

    if (initVerbose) {
      console.log(`[verbose] init: file patterns: ${fileGlobs.join(', ')}`);
      if (additionalPackages.length > 0)
        console.log(`[verbose] init: additional packages: ${additionalPackages.join(', ')}`);
      console.log(`[verbose] init: gitignore=${initGitignore} unmanaged=${initUnmanaged}`);
      console.log(`[verbose] init: writing publisher configuration...`);
    }

    const result = await initPublisher(fileGlobs, {
      additionalPackages,
      gitignore: initGitignore,
      ...(initUnmanaged ? { unmanaged: true } : {}),
    });

    if (!result.success) {
      console.error(`\nError: ${result.message}`);
      return 1;
    }

    if (initVerbose) {
      console.log(`[verbose] init: configuration written successfully`);
    }
    console.log(`\n${result.message}`);
    if (result.publishedFiles) {
      console.log(
        `\nThe following file patterns will be published: ${result.publishedFiles.join(', ')}`,
      );
    }
    if (result.additionalPackages && result.additionalPackages.length > 0) {
      console.log(`\nAdditional data source packages: ${result.additionalPackages.join(', ')}`);
    }

    return 0;
  }

  // Handle list command
  if (command === 'list') {
    let outDir = process.cwd();
    let outputFlagProvided = false;
    let listVerbose = false;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--output' || args[i] === '-o') {
        outDir = args[++i];
        outputFlagProvided = true;
      } else if (args[i] === '--verbose' || args[i] === '-v') {
        listVerbose = true;
      } else if (!args[i].startsWith('-')) {
        outDir = args[i];
        outputFlagProvided = true;
      }
    }

    if (!outputFlagProvided) {
      console.info(`Listing managed files in current directory: ${outDir}`);
    }

    if (listVerbose) {
      console.log(`[verbose] list: resolved output directory: ${path.resolve(outDir)}`);
      console.log(`[verbose] list: scanning for .npmdata marker files...`);
    }

    const entries = list(path.resolve(outDir));

    if (listVerbose) {
      console.log(
        `[verbose] list: found ${entries.length} managed package entr${entries.length === 1 ? 'y' : 'ies'}`,
      );
    }

    if (entries.length === 0) {
      console.log('No managed files found.');
      return 0;
    }

    for (const entry of entries) {
      if (listVerbose) {
        console.log(
          `[verbose] list: package ${entry.packageName}@${entry.packageVersion} has ${entry.files.length} managed file${entry.files.length === 1 ? '' : 's'}`,
        );
      }
      console.log(`\n${entry.packageName}@${entry.packageVersion} (${entry.files.length} files)`);
      for (const f of entry.files) {
        console.log(`  ${f}`);
      }
    }
    return 0;
  }

  // Handle purge command
  if (command === 'purge') {
    let purgePackageSpecs: string | undefined;
    let purgeOutDir = process.cwd();
    let purgeOutputFlagProvided = false;
    let purgeDryRun = false;
    let purgeSilent = false;
    let purgeVerbose = false;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--packages') {
        purgePackageSpecs = args[++i];
      } else if (args[i] === '--output' || args[i] === '-o') {
        purgeOutDir = args[++i];
        purgeOutputFlagProvided = true;
      } else if (args[i] === '--dry-run') {
        purgeDryRun = true;
      } else if (args[i] === '--silent') {
        purgeSilent = true;
      } else if (args[i] === '--verbose' || args[i] === '-v') {
        purgeVerbose = true;
      } else if (!args[i].startsWith('-')) {
        purgeOutDir = args[i];
        purgeOutputFlagProvided = true;
      }
    }

    if (!purgePackageSpecs) {
      const npmdataConfig = await loadNpmdataConfig();
      // eslint-disable-next-line no-undefined
      if (npmdataConfig !== undefined) {
        const effectiveCliPath = cliPath ?? processArgs[1];
        runEntries(
          npmdataConfig.sets,
          'purge',
          processArgs,
          effectiveCliPath,
          npmdataConfig.postExtractScript,
        );
        return 0;
      }
      console.error(`Error: --packages option is required for 'purge' command`);
      printUsage();
      return 1;
    }

    if (!purgeOutputFlagProvided && !purgeSilent) {
      console.info(`No --output specified. Using current directory: ${purgeOutDir}`);
    }

    const purgePackages = purgePackageSpecs.split(',').map((s) => s.trim());

    if (purgeVerbose) {
      console.log(`[verbose] purge: packages to remove: ${purgePackages.join(', ')}`);
      console.log(`[verbose] purge: output directory: ${path.resolve(purgeOutDir)}`);
      console.log(`[verbose] purge: dryRun=${purgeDryRun}`);
    }

    const purgeOnProgress = purgeSilent
      ? // eslint-disable-next-line no-undefined
        undefined
      : (event: ProgressEvent): void => {
          switch (event.type) {
            case 'package-start':
              console.log(`>> Package ${event.packageName}`);
              if (purgeVerbose) {
                console.log(
                  `[verbose] purge: starting removal of managed files for ${event.packageName}`,
                );
              }
              break;
            case 'file-deleted':
              console.log(`D\t${event.file}`);
              if (purgeVerbose) {
                console.log(`[verbose] purge: deleted file: ${event.file}`);
              }
              break;
            default:
              break;
          }
        };

    if (!purgeSilent) {
      if (purgeDryRun) console.info('Dry run: simulating purge (no files will be removed)...');
      else console.info('Purging managed files...');
    }

    const purgeResult = await purge({
      packages: purgePackages,
      outputDir: path.resolve(purgeOutDir),
      dryRun: purgeDryRun,
      onProgress: purgeOnProgress,
    });

    console.log(
      `Purge complete: ${purgeResult.deleted.length} deleted${purgeDryRun ? ' (dry run)' : ''}`,
    );
    return 0;
  }

  // Consumer commands (extract, check)
  if (!['extract', 'check'].includes(command)) {
    console.error(
      `Error: unknown command '${command}'. Use 'init', 'extract', 'check', 'purge', or 'list'`,
    );
    printUsage();
    return 1;
  }

  // Parse options common to extract and check
  let packageSpecs: string | undefined;
  let force = false;
  let keepExisting = false;
  let gitignore = true;
  let dryRun = false;
  let upgrade = false;
  let silent = false;
  let verbose = false;
  let unmanaged = false;
  let filenamePatterns: string | undefined;
  let contentRegexes: string | undefined;
  let outDir = process.cwd();
  let outputFlagProvided = false;
  // Cascade filter sets collected from --cascade-files / --cascade-content-regex flags,
  // ordered from deepest dependency to the immediate source package.
  const cascadeFileSets: string[][] = [];
  const cascadeContentRegexSets: string[][] = [];

  for (let i = argsOffset; i < args.length; i++) {
    if (args[i] === '--packages') {
      packageSpecs = args[++i];
    } else if (args[i] === '--force') {
      force = true;
    } else if (args[i] === '--keep-existing') {
      keepExisting = true;
    } else if (args[i] === '--silent') {
      silent = true;
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--no-gitignore') {
      gitignore = false;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--upgrade') {
      upgrade = true;
    } else if (args[i] === '--unmanaged') {
      unmanaged = true;
    } else if (args[i] === '--files') {
      filenamePatterns = args[++i];
    } else if (args[i] === '--content-regex') {
      contentRegexes = args[++i];
    } else if (args[i] === '--cascade-files') {
      // eslint-disable-next-line no-plusplus
      cascadeFileSets.push(args[++i].split(',').map((p) => p.trim()));
    } else if (args[i] === '--cascade-content-regex') {
      // eslint-disable-next-line no-plusplus
      cascadeContentRegexSets.push(args[++i].split(',').map((r) => r.trim()));
    } else if (args[i] === '--output' || args[i] === '-o') {
      outDir = args[++i];
      outputFlagProvided = true;
    } else if (!args[i].startsWith('-')) {
      outDir = args[i];
      outputFlagProvided = true;
    }
  }

  if (!packageSpecs) {
    const npmdataConfig = await loadNpmdataConfig();
    // eslint-disable-next-line no-undefined
    if (npmdataConfig !== undefined) {
      const effectiveCliPath = cliPath ?? processArgs[1];
      runEntries(
        npmdataConfig.sets,
        command,
        processArgs,
        effectiveCliPath,
        npmdataConfig.postExtractScript,
      );
      return 0;
    }
    console.error(`Error: --packages option is required for '${command}' command`);
    printUsage();
    return 1;
  }

  if (!outputFlagProvided && !silent) {
    console.info(`No --output specified. Using current directory: ${outDir}`);
  }

  if (verbose && !silent) {
    console.log(`[verbose] ${command}: packages=${packageSpecs} output=${path.resolve(outDir)}`);
    if (command === 'extract') {
      console.log(
        `[verbose] extract: force=${force} keepExisting=${keepExisting} dryRun=${dryRun} upgrade=${upgrade} unmanaged=${unmanaged} gitignore=${gitignore}`,
      );
      if (filenamePatterns)
        console.log(`[verbose] extract: file filter patterns: ${filenamePatterns}`);
      if (contentRegexes)
        console.log(`[verbose] extract: content regex filters: ${contentRegexes}`);
    }
  }

  if (force && keepExisting) {
    console.error('Error: --force and --keep-existing cannot be used together');
    return 1;
  }

  const packages = packageSpecs.split(',').map((s) => s.trim());

  // Build onProgress handler that prints file-level events grouped by package
  const onProgress = silent
    ? // eslint-disable-next-line no-undefined
      undefined
    : (event: ProgressEvent): void => {
        switch (event.type) {
          case 'package-start':
            console.log(`>> Package ${event.packageName}@${event.packageVersion}`);
            if (verbose) {
              console.log(
                `[verbose] ${command}: starting processing of package ${event.packageName}@${event.packageVersion}`,
              );
            }
            break;
          case 'file-added':
            console.log(`A\t${event.file}`);
            if (verbose) {
              console.log(`[verbose] ${command}: added file: ${event.file}`);
            }
            break;
          case 'file-modified':
            console.log(`M\t${event.file}`);
            if (verbose) {
              console.log(`[verbose] ${command}: modified file: ${event.file}`);
            }
            break;
          case 'file-deleted':
            console.log(`D\t${event.file}`);
            if (verbose) {
              console.log(`[verbose] ${command}: deleted file: ${event.file}`);
            }
            break;
          case 'file-skipped':
            if (verbose) {
              console.log(`[verbose] ${command}: skipped file: ${event.file}`);
            }
            break;
          case 'package-end':
            if (verbose) {
              console.log(
                `[verbose] ${command}: finished processing package ${event.packageName}@${event.packageVersion}`,
              );
            }
            break;
          default:
            break;
        }
      };

  const config: ConsumerConfig = {
    packages,
    outputDir: path.resolve(outDir),
    force,
    keepExisting,
    gitignore,
    dryRun,
    upgrade,
    unmanaged,
    onProgress,
    filenamePatterns: filenamePatterns
      ? filenamePatterns.split(',')
      : // eslint-disable-next-line no-undefined
        undefined,
    contentRegexes: contentRegexes
      ? contentRegexes.split(',').map((r) => new RegExp(r))
      : // eslint-disable-next-line no-undefined
        undefined,
    cascadeFilenamePatternSets: cascadeFileSets.length > 0 ? cascadeFileSets : undefined,
    cascadeContentRegexSets:
      cascadeContentRegexSets.length > 0 ? cascadeContentRegexSets : undefined,
  };

  if (command === 'extract') {
    if (!silent) {
      if (dryRun) console.info('Dry run: simulating extraction (no files will be written)...');
      else console.info('Extracting package files...');
    }
    if (verbose) {
      console.log(`[verbose] extract: installing/resolving packages: ${packages.join(', ')}`);
    }

    const result = await extract(config);

    if (verbose) {
      console.log(
        `[verbose] extract: processing complete - added=${result.added.length} modified=${result.modified.length} deleted=${result.deleted.length} skipped=${result.skipped.length}`,
      );
    }
    console.log(
      `Extraction complete: ${result.added.length} added, ${result.modified.length} modified, ${result.deleted.length} deleted, ${result.skipped.length} skipped${dryRun ? ' (dry run)' : ''}`,
    );
    return 0;
  }

  if (command === 'check') {
    const relDir = path.relative(process.cwd(), config.outputDir) || '.';
    console.log(`Checking data from ${config.packages.join(', ')} against ${relDir}...`);
    if (verbose) {
      console.log(`[verbose] check: resolved output directory: ${config.outputDir}`);
      console.log(`[verbose] check: installing/resolving packages: ${config.packages.join(', ')}`);
    }
    const result = await check(config);
    if (verbose) {
      console.log(
        `[verbose] check: comparison complete, ${result.sourcePackages.length} package${result.sourcePackages.length === 1 ? '' : 's'} checked`,
      );
    }

    for (const pkg of result.sourcePackages) {
      const pkgLabel = `${pkg.name}@${pkg.version}`;
      if (pkg.ok) {
        console.log(`  ${pkgLabel}: in sync`);
        if (verbose) {
          console.log(`[verbose] check: package ${pkgLabel} - all files match`);
        }
      } else {
        console.log(`  ${pkgLabel}: out of sync`);
        if (verbose) {
          console.log(
            `[verbose] check: package ${pkgLabel} - missing=${pkg.differences.missing.length} modified=${pkg.differences.modified.length} extra=${pkg.differences.extra.length}`,
          );
        }
        for (const f of pkg.differences.missing) console.log(`    - missing:  ${f}`);
        for (const f of pkg.differences.modified) console.log(`    ~ modified: ${f}`);
        for (const f of pkg.differences.extra) console.log(`    + extra:    ${f}`);
      }
    }

    if (result.ok) {
      console.log('All files are in sync');
      return 0;
    }

    console.log('Files are out of sync');
    return 2;
  }

  // unreachable, but satisfies TypeScript
  return 1;
}

/**
 * Search for an npmdata configuration using cosmiconfig.
 * Looks for:
 *   - "npmdata" key in package.json (object with "sets" array)
 *   - .npmdatarc  (JSON or YAML object with "sets" array)
 *   - .npmdatarc.json / .npmdatarc.yaml / .npmdatarc.js
 *   - npmdata.config.js
 *
 * The resolved value must be an object with a "sets" array of NpmdataExtractEntry objects.
 * Returns the sets array when found, or undefined when no configuration is present.
 */
async function loadNpmdataConfig(): Promise<NpmdataConfig | undefined> {
  const explorer = cosmiconfig('npmdata');
  const result = await explorer.search();
  if (!result || result.isEmpty) {
    // eslint-disable-next-line no-undefined
    return undefined;
  }
  const cfg = result.config as NpmdataConfig;
  if (!cfg || !Array.isArray(cfg.sets) || cfg.sets.length === 0) {
    // eslint-disable-next-line no-undefined
    return undefined;
  }
  return cfg;
}

function printUsage(): void {
  console.log(`
npmdata

Usage:
  npx npmdata [init|extract|check|purge|list] [options]

Commands:
  init                         Initialize publishing configuration
  extract                      Extract files from one or more published packages
  check                        Verify if local files are in sync with packages
  purge                        Remove all managed files written by given packages
  list                         List all managed files in the output directory

Global Options:
  --help, -h                   Show this help message
  --version                    Show version
  --verbose, -v                Print detailed progress information for each step

Init Options:
  --files <patterns>           Comma-separated glob patterns of files to publish (required)
                               e.g. "docs/**,data/**,configs/*.json"
  --packages <specs>           Comma-separated additional package specs to use as data sources.
                               Each spec is "name" or "name@version"
                               e.g. "shared-data@^1.0.0,other-pkg@2.x"
  --unmanaged                  Mark all npmdata entries as unmanaged (see Extract options)
  --verbose, -v                Print detailed progress information for each step

Extract / Check Options:
  --packages <specs>           Comma-separated package specs to extract from.
                               When omitted, npmdata searches for a configuration file
                               (package.json "npmdata" key, .npmdatarc, etc.) and runs
                               all entries defined there.
                               Each spec is "name" or "name@version"
                               e.g. "my-pkg@^1.2.3,other-pkg@2.x"
  --output, -o <dir>           Output directory (default: current directory, with a warning)
  --force                      Allow overwriting existing unmanaged files
  --keep-existing              Skip files that already exist in the output directory;
                               create them when absent. Cannot be combined with --force
  --no-gitignore               Skip creating/updating .gitignore (gitignore is enabled by default)
  --unmanaged                  Write files without a .npmdata marker, .gitignore update, or
                               read-only flag. Existing files are skipped. Files can be freely
                               edited afterwards and are not tracked by npmdata.
  --dry-run                    Simulate extraction without writing any files
  --upgrade                    Re-install packages even when a satisfying version is installed
  --silent                     Print only the final result line, suppressing package and file listing
  --verbose, -v                Print detailed progress information for each step
  --files <pattern>            Comma-separated shell glob patterns to filter files
  --content-regex <regex>      Regex pattern to match file contents

Purge Options:
  --packages <specs>           Comma-separated package names whose managed files should be removed.
                               When omitted, npmdata searches for a configuration file
                               (package.json "npmdata" key, .npmdatarc, etc.) and purges
                               all entries defined there.
  --output, -o <dir>           Output directory to purge from (default: current directory)
  --dry-run                    Simulate purge without removing any files
  --silent                     Suppress per-file output
  --verbose, -v                Print detailed progress information for each step

List Options:
  --output, -o <dir>           Directory to inspect (default: current directory)
  --verbose, -v                Print detailed progress information for each step

Examples:
  npx npmdata init --files "data/**,docs/**,configs/*.json"
  npx npmdata extract --packages mydataset --output ./data
  npx npmdata extract --packages mydataset@^2.0.0 --output ./data
  npx npmdata extract --packages "mydataset@^2.0.0,otherpkg@1.x" --output ./data
  npx npmdata extract          # reads npmdata config from package.json or .npmdatarc
  npx npmdata check            # reads npmdata config from package.json or .npmdatarc
  npx npmdata purge            # reads npmdata config from package.json or .npmdatarc
  npx npmdata extract --packages mydataset --dry-run --output ./data
  npx npmdata extract --packages mydataset --silent --output ./data
  npx npmdata extract --packages mydataset --upgrade --output ./data
  npx npmdata extract --packages mydataset --files "*.md,docs/**" --output ./docs
  npx npmdata check --packages mydataset --output ./data
  npx npmdata check --packages "mydataset,otherpkg" --output ./data
  npx npmdata list --output ./data
  npx npmdata purge --packages mydataset --output ./data
  npx npmdata purge --packages "mydataset,otherpkg" --output ./data
`);
}
