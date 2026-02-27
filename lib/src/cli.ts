#!/usr/bin/env node
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-plusplus */
/* eslint-disable functional/no-let */
/* eslint-disable no-console */

import fs from 'node:fs';
import path from 'node:path';

import { extract, check } from './consumer';
import { ConsumerConfig } from './types';
import { initPublisher } from './publisher';
import { getInstalledPackageVersion } from './utils';

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

    // Parse args for --folders flag
    // eslint-disable-next-line functional/no-let
    for (let i = 1; i < args.length; i += 1) {
      if (args[i] === '--folders') {
        // eslint-disable-next-line no-plusplus
        sourceFoldersFlag = args[++i];
      }
    }

    // --folders is required
    if (!sourceFoldersFlag) {
      console.error('Error: --folders option is required for init command');
      printUsage();
      return 1;
    }

    const folders = sourceFoldersFlag.split(',').map((f) => f.trim());

    const result = await initPublisher(folders);

    if (!result.success) {
      console.error(`\n✗ Error: ${result.message}`);
      return 1;
    }

    console.log(`\n✓ ${result.message}`);
    if (result.publishedFolders) {
      console.log(
        `\nThe following folders will be published: ${result.publishedFolders.join(', ')}`,
      );
    }

    return 0;
  }

  // Consumer commands (extract, check)
  if (!['extract', 'check'].includes(command)) {
    console.error(`Error: unknown command '${command}'. Use 'init', 'extract', or 'check'`);
    printUsage();
    return 1;
  }

  // Parse options
  let packageName: string | undefined;
  let version: string | undefined;
  let force = false;
  let gitignore = false;
  let filenamePatterns: string | undefined;
  let contentRegexes: string | undefined;
  let outDir = process.cwd();

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--package' || args[i] === '-p') {
      packageName = args[++i];
    } else if (args[i] === '--version') {
      version = args[++i];
    } else if (args[i] === '--force') {
      force = true;
    } else if (args[i] === '--gitignore') {
      gitignore = true;
    } else if (args[i] === '--files') {
      filenamePatterns = args[++i];
    } else if (args[i] === '--content-regex') {
      contentRegexes = args[++i];
    } else if (args[i] === '--output' || args[i] === '-o') {
      outDir = args[++i];
    } else if (!args[i].startsWith('-')) {
      outDir = args[i];
    }
  }

  if (!packageName) {
    console.error(`Error: --package option is required for '${command}' command`);
    printUsage();
    return 1;
  }

  const config: ConsumerConfig = {
    packageName,
    version,
    outputDir: path.resolve(outDir),
    force,
    gitignore,
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
    const installedVersion = getInstalledPackageVersion(config.packageName, config.cwd);
    const relDir = path.relative(process.cwd(), config.outputDir) || '.';
    console.info(
      `Extracting files from ${config.packageName}${installedVersion ? `@${installedVersion}` : ''} to '${relDir}'...`,
    );

    const result = await extract(config);

    const allChanged = [
      ...result.added.map((f) => `A\t${f}`),
      ...result.modified.map((f) => `M\t${f}`),
      ...result.deleted.map((f) => `D\t${f}`),
    ];

    if (allChanged.length > 0) {
      console.log('');
      for (const line of allChanged) console.log(line);
    }

    console.log(
      `\nExtraction complete: ${result.added.length} added, ${result.modified.length} modified, ${result.deleted.length} deleted, ${result.skipped.length} skipped`,
    );
    return 0;
  }
  if (command === 'check') {
    const installedVersion = getInstalledPackageVersion(config.packageName, config.cwd);
    const relDir = path.relative(process.cwd(), config.outputDir) || '.';
    console.log(
      `\nChecking data from ${config.packageName}${installedVersion ? `@${installedVersion}` : ''} against ${relDir}...`,
    );
    const result = await check(config);

    if (result.ok) {
      console.log('✓ All files are in sync');
      return 0;
    }
    console.log('✗ Files are out of sync:');

    if (result.differences.missing.length > 0) {
      console.log('\nMissing files:');
      for (const f of result.differences.missing) console.log(`  - ${f}`);
    }

    if (result.differences.modified.length > 0) {
      console.log('\nModified files:');
      for (const f of result.differences.modified) console.log(`  ~ ${f}`);
    }

    return 2;
  }
  // unreachable, but satisfies TypeScript
  return 1;
}

function printUsage(): void {
  console.log(`
npmdata

Usage:
  npx npmdata [init|extract|check] [options]

Commands:
  init                         Initialize publishing configuration
  extract                      Extract files from a published package
  check                        Verify if local files are in sync with a package

Global Options:
  --help, -h                   Show this help message
  --version, -v                Show version

Init Options:
  --folders <folders>          Comma-separated list of source folders to publish (required)

Extract / Check Options:
  --package, -p <name>         Package name to extract from (required)
  --version <version>          Version constraint (e.g., "1.0.0", "^1.0.0")
  --force                      Allow overwriting existing files
  --gitignore                  Create/update .gitignore files to ignore managed files and .publisher
  --files <pattern>            Comma-separated shell glob patterns
  --content-regex <regex>      Regex pattern to match file contents
  --output, -o <dir>           Output directory (default: current directory)

Examples:
  npx npmdata init --folders "data,docs,config"
  npx npmdata extract --package mydataset --output ./data
  npx npmdata extract --package mydataset --version "^2.0.0" --output ./data
  npx npmdata extract --package mydataset --files "*.md,docs/**" --output ./docs
  npx npmdata check --package mydataset --output ./data
`);
}
