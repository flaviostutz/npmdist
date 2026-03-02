#!/usr/bin/env node
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-plusplus */
/* eslint-disable functional/no-let */
/* eslint-disable no-console */

import fs from 'node:fs';
import path from 'node:path';

import { extract, check, list } from './consumer';
import { ConsumerConfig, ProgressEvent } from './types';
import { initPublisher } from './publisher';

/**
 * CLI for npmdata
 */
// eslint-disable-next-line complexity
export async function cli(processArgs: string[]): Promise<number> {
  const args = processArgs.slice(2);

  if (args.length === 0) {
    printUsage();
    return 1;
  }

  const command = args[0];

  // Handle global help and version flags
  if (command === '--help' || command === '-h') {
    printUsage();
    return 0;
  }

  if (command === '--version' || command === '-v') {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json')).toString());
    console.log(pkg.version);
    return 0;
  }

  // Handle init command
  if (command === 'init') {
    // eslint-disable-next-line functional/no-let
    let sourceFoldersFlag: string | undefined;
    // eslint-disable-next-line functional/no-let
    let additionalPackagesFlag: string | undefined;

    // Parse args for --folders and --packages flags
    // eslint-disable-next-line functional/no-let
    for (let i = 1; i < args.length; i += 1) {
      if (args[i] === '--folders') {
        // eslint-disable-next-line no-plusplus
        sourceFoldersFlag = args[++i];
      } else if (args[i] === '--packages') {
        // eslint-disable-next-line no-plusplus
        additionalPackagesFlag = args[++i];
      }
    }

    // --folders is required
    if (!sourceFoldersFlag) {
      console.error('Error: --folders option is required for init command');
      printUsage();
      return 1;
    }

    const folders = sourceFoldersFlag.split(',').map((f) => f.trim());
    const additionalPackages = additionalPackagesFlag
      ? additionalPackagesFlag.split(',').map((p) => p.trim())
      : [];

    const result = await initPublisher(folders, { additionalPackages });

    if (!result.success) {
      console.error(`\nError: ${result.message}`);
      return 1;
    }

    console.log(`\n${result.message}`);
    if (result.publishedFolders) {
      console.log(
        `\nThe following folders will be published: ${result.publishedFolders.join(', ')}`,
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

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--output' || args[i] === '-o') {
        outDir = args[++i];
        outputFlagProvided = true;
      } else if (!args[i].startsWith('-')) {
        outDir = args[i];
        outputFlagProvided = true;
      }
    }

    if (!outputFlagProvided) {
      console.info(`Listing managed files in current directory: ${outDir}`);
    }

    const entries = list(path.resolve(outDir));

    if (entries.length === 0) {
      console.log('No managed files found.');
      return 0;
    }

    for (const entry of entries) {
      console.log(`\n${entry.packageName}@${entry.packageVersion} (${entry.files.length} files)`);
      for (const f of entry.files) {
        console.log(`  ${f}`);
      }
    }
    return 0;
  }

  // Consumer commands (extract, check)
  if (!['extract', 'check'].includes(command)) {
    console.error(`Error: unknown command '${command}'. Use 'init', 'extract', 'check', or 'list'`);
    printUsage();
    return 1;
  }

  // Parse options common to extract and check
  let packageSpecs: string | undefined;
  let force = false;
  let gitignore = false;
  let dryRun = false;
  let upgrade = false;
  let silent = false;
  let filenamePatterns: string | undefined;
  let contentRegexes: string | undefined;
  let outDir = process.cwd();
  let outputFlagProvided = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--packages') {
      packageSpecs = args[++i];
    } else if (args[i] === '--force') {
      force = true;
    } else if (args[i] === '--silent') {
      silent = true;
    } else if (args[i] === '--gitignore') {
      gitignore = true;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--upgrade') {
      upgrade = true;
    } else if (args[i] === '--files') {
      filenamePatterns = args[++i];
    } else if (args[i] === '--content-regex') {
      contentRegexes = args[++i];
    } else if (args[i] === '--output' || args[i] === '-o') {
      outDir = args[++i];
      outputFlagProvided = true;
    } else if (!args[i].startsWith('-')) {
      outDir = args[i];
      outputFlagProvided = true;
    }
  }

  if (!packageSpecs) {
    console.error(`Error: --packages option is required for '${command}' command`);
    printUsage();
    return 1;
  }

  if (!outputFlagProvided && !silent) {
    console.info(`No --output specified. Using current directory: ${outDir}`);
  }

  const packages = packageSpecs.split(',').map((s) => s.trim());

  // Build onProgress handler that prints file-level events grouped by package
  const onProgress = silent
    ? // eslint-disable-next-line no-undefined
      undefined
    : (event: ProgressEvent): void => {
        switch (event.type) {
          case 'package-start':
            console.log(`\n>> Package ${event.packageName}@${event.packageVersion}`);
            break;
          case 'file-added':
            console.log(`A\t${event.file}`);
            break;
          case 'file-modified':
            console.log(`M\t${event.file}`);
            break;
          case 'file-deleted':
            console.log(`D\t${event.file}`);
            break;
          default:
            break;
        }
      };

  const config: ConsumerConfig = {
    packages,
    outputDir: path.resolve(outDir),
    force,
    gitignore,
    dryRun,
    upgrade,
    onProgress,
    filenamePatterns: filenamePatterns
      ? filenamePatterns.split(',')
      : // eslint-disable-next-line no-undefined
        undefined,
    contentRegexes: contentRegexes
      ? contentRegexes.split(',').map((r) => new RegExp(r))
      : // eslint-disable-next-line no-undefined
        undefined,
  };

  if (command === 'extract') {
    if (!silent) {
      if (dryRun) console.info('Dry run: simulating extraction (no files will be written)...');
      else console.info('Extracting package files...');
    }

    const result = await extract(config);

    console.log(
      `\nExtraction complete: ${result.added.length} added, ${result.modified.length} modified, ${result.deleted.length} deleted, ${result.skipped.length} skipped${dryRun ? ' (dry run)' : ''}`,
    );
    return 0;
  }

  if (command === 'check') {
    const relDir = path.relative(process.cwd(), config.outputDir) || '.';
    console.log(`\nChecking data from ${config.packages.join(', ')} against ${relDir}...`);
    const result = await check(config);

    for (const pkg of result.sourcePackages) {
      const pkgLabel = `${pkg.name}@${pkg.version}`;
      if (pkg.ok) {
        console.log(`  ${pkgLabel}: in sync`);
      } else {
        console.log(`  ${pkgLabel}: out of sync`);
        for (const f of pkg.differences.missing) console.log(`    - missing:  ${f}`);
        for (const f of pkg.differences.modified) console.log(`    ~ modified: ${f}`);
        for (const f of pkg.differences.extra) console.log(`    + extra:    ${f}`);
      }
    }

    if (result.ok) {
      console.log('\nAll files are in sync');
      return 0;
    }

    console.log('\nFiles are out of sync');
    return 2;
  }

  // unreachable, but satisfies TypeScript
  return 1;
}

function printUsage(): void {
  console.log(`
npmdata

Usage:
  npx npmdata [init|extract|check|list] [options]

Commands:
  init                         Initialize publishing configuration
  extract                      Extract files from one or more published packages
  check                        Verify if local files are in sync with packages
  list                         List all managed files in the output directory

Global Options:
  --help, -h                   Show this help message
  --version, -v                Show version

Init Options:
  --folders <folders>          Comma-separated list of source folders to publish (required)
  --packages <specs>           Comma-separated additional package specs to use as data sources.
                               Each spec is "name" or "name@version"
                               e.g. "shared-data@^1.0.0,other-pkg@2.x"

Extract / Check Options:
  --packages <specs>           Comma-separated package specs to extract from (required).
                               Each spec is "name" or "name@version"
                               e.g. "my-pkg@^1.2.3,other-pkg@2.x"
  --output, -o <dir>           Output directory (default: current directory, with a warning)
  --force                      Allow overwriting existing unmanaged files
  --gitignore                  Create/update .gitignore to ignore managed files and .npmdata
  --dry-run                    Simulate extraction without writing any files
  --upgrade                    Re-install packages even when a satisfying version is installed
  --silent                     Print only the final result line, suppressing package and file listing
  --files <pattern>            Comma-separated shell glob patterns to filter files
  --content-regex <regex>      Regex pattern to match file contents

List Options:
  --output, -o <dir>           Directory to inspect (default: current directory)

Examples:
  npx npmdata init --folders "data,docs,config"
  npx npmdata extract --packages mydataset --output ./data
  npx npmdata extract --packages mydataset@^2.0.0 --output ./data
  npx npmdata extract --packages "mydataset@^2.0.0,otherpkg@1.x" --output ./data
  npx npmdata extract --packages mydataset --dry-run --output ./data
  npx npmdata extract --packages mydataset --silent --output ./data
  npx npmdata extract --packages mydataset --upgrade --output ./data
  npx npmdata extract --packages mydataset --files "*.md,docs/**" --output ./docs
  npx npmdata check --packages mydataset --output ./data
  npx npmdata check --packages "mydataset,otherpkg" --output ./data
  npx npmdata list --output ./data
`);
}
