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
 * CLI for folder-publisher
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
  const packageName = command;

  if (!args[1] || !['extract', 'check'].includes(args[1])) {
    console.error(
      `Error: subcommand required after package name. Use 'extract' or 'check'${
        args[1] ? ` (got '${args[1]}')` : ''
      }`,
    );
    printUsage();
    return 1;
  }

  const subCommand = args[1];

  // Parse options
  let version: string | undefined;
  let checkFlag = false;
  let allowConflicts = false;
  let filenamePatterns: string | undefined;
  let contentRegexes: string | undefined;
  let outDir = process.cwd();

  // Default patterns (will exclude common files present in packages that are not meant to be extracted normally)
  const defaultPatterns = ['!package.json', '!bin/**', '!README.md', '!node_modules/**'];

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--version') {
      version = args[++i];
    } else if (args[i] === '--check') {
      checkFlag = true;
    } else if (args[i] === '--allow-conflicts') {
      allowConflicts = true;
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

  const config: ConsumerConfig = {
    packageName,
    version,
    outputDir: path.resolve(outDir),
    check: checkFlag,
    allowConflicts,
    filenamePatterns: filenamePatterns ? filenamePatterns.split(',') : defaultPatterns,
    contentRegexes: contentRegexes
      ? contentRegexes.split(',').map((r) => new RegExp(r))
      : // eslint-disable-next-line no-undefined
        undefined,
  };

  if (subCommand === 'extract') {
    const installedVersion = getInstalledPackageVersion(config.packageName, config.cwd);
    if (!installedVersion) {
      throw new Error(`Failed to determine installed version of package ${config.packageName}`);
    }

    console.info(`Extracting files from ${config.packageName}@${installedVersion}...`);

    const result = await extract(config);

    console.log(
      `\n✓ Extraction complete: ${result.created} created, ${result.updated} updated, ${result.deleted} deleted`,
    );

    if (result.changes.created.length > 0) {
      console.log('\nCreated files:');
      for (const f of result.changes.created) console.log(`  + ${f}`);
    }

    if (result.changes.updated.length > 0) {
      console.log('\nUpdated files:');
      for (const f of result.changes.updated) console.log(`  ~ ${f}`);
    }

    if (result.changes.deleted.length > 0) {
      console.log('\nDeleted files:');
      for (const f of result.changes.deleted) console.log(`  - ${f}`);
    }

    console.log(`\nPackage: ${result.sourcePackage.name}@${result.sourcePackage.version}`);
    return 0;
  }
  if (subCommand === 'check') {
    console.log(`\nChecking ${packageName}...`);
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

    if (result.differences.extra.length > 0) {
      console.log('\nExtra files (not in package):');
      for (const f of result.differences.extra) console.log(`  + ${f}`);
    }

    return 2;
  }
  // unreachable, but satisfies TypeScript
  return 1;
}

function printUsage(): void {
  console.log(`
folder-publisher

Usage:
  npx folder-publisher <command> [options]

Commands (Publisher):
  init --folders <folders>     Initialize publishing configuration with specified folders

Commands (Consumer):
  <package-name> extract [options]   Extract files from published package
  <package-name> check   [options]   Verify if files are in sync

Publisher Options:
  --folders <folders>          Comma-separated list of source folders to publish
  --help, -h                   Show this help message
  --version, -v                Show version

Consumer Options:
  --version <version>          Version constraint (e.g., "1.0.0", "^1.0.0")
  --check                      Run in check mode instead of extract
  --allow-conflicts            Allow overwriting existing files
  --files <pattern>           Comma-separated shell glob patterns
  --content-regex <regex>      Regex pattern to match file contents
  --output, -o <dir>           Output directory (default: current directory)

Examples:
  npx folder-publisher init --folders "data,docs,config"
  npx mydataset extract --output ./data
  npx mydataset extract --version "^2.0.0" --output ./data
  npx mydataset extract --files "*.md,docs/**" --output ./docs
  npx mydataset check --output ./data
`);
}
