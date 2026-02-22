#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';

import { Consumer } from './consumer';
import { ConsumerConfig } from './types';
import { PublisherInit } from './publisher-init';

/**
 * CLI for folder-publisher
 */
export async function cli(processArgs: string[]): Promise<number> {
  const args = process.argv.slice(2);

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
    let sourceFoldersFlag: string | undefined;

    // Parse args for --folders flag
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--folders') {
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

    const publisher = new PublisherInit();
    const result = await publisher.init(folders);

    if (!result.success) {
      console.error(`\n✗ Error: ${result.message}`);
      return 1;
    }

    console.log(`\n✓ ${result.message}`);
    if (result.publishedFolders) {
      console.log(`\nThe following folders will be published: ${result.publishedFolders.join(', ')}`);
    }

    return 0;
  }

  // Consumer commands (extract, check)
  const packageName = command;
  const subCommand = args[1] || 'extract';
  const outputDir = args[2] || process.cwd();

  // Parse options
  let version: string | undefined;
  let check = false;
  let allowConflicts = false;
  let filenamePattern: string | undefined;
  let contentRegex: string | undefined;
  let outDir = outputDir;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--version') {
      version = args[++i];
    } else if (args[i] === '--check') {
      check = true;
    } else if (args[i] === '--allow-conflicts') {
      allowConflicts = true;
    } else if (args[i] === '--filename-pattern') {
      filenamePattern = args[++i];
    } else if (args[i] === '--content-regex') {
      contentRegex = args[++i];
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
    check,
    allowConflicts,
    filenamePattern: filenamePattern ? filenamePattern.split(',') : undefined,
    contentRegex: contentRegex ? new RegExp(contentRegex) : undefined,
  };

  const consumer = new Consumer(config);

  if (subCommand === 'extract') {
    console.log(`\nExtracting files from ${packageName}...`);
    const result = await consumer.extract();

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

    console.log(`\nPackage: ${result.package.name}@${result.package.version}`);
    return 0;

  } else if (subCommand === 'check') {
    console.log(`\nChecking ${packageName}...`);
    const result = await consumer.check();

    if (result.ok) {
      console.log('✓ All files are in sync');
      return 0;
    } else {
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
  } else {
    console.error(`Unknown command: ${subCommand}`);
    printUsage();
    return 1;
  }
}

function printUsage() {
  console.log(`
folder-publisher

Usage:
  npx folder-publisher <command> [options]

Commands (Publisher):
  init --folders <folders>     Initialize publishing configuration with specified folders

Commands (Consumer):
  <package-name> [command] [options]
                               Extract files from published package
    Commands:
      extract                  Extract files from package (default)
      check                    Verify if files are in sync

Publisher Options:
  --folders <folders>          Comma-separated list of source folders to publish
  --help, -h                   Show this help message
  --version, -v                Show version

Consumer Options:
  --version <version>          Version constraint (e.g., "1.0.0", "^1.0.0")
  --check                      Run in check mode instead of extract
  --allow-conflicts            Allow overwriting existing files
  --filename-pattern <pattern> Comma-separated shell glob patterns
  --content-regex <regex>      Regex pattern to match file contents
  --output, -o <dir>           Output directory (default: current directory)

Examples:
  npx folder-publisher init --folders "data,docs,config"
  npx mydataset@1.0.0
  npx mydataset --version "^2.0.0" --output ./data
  npx mydataset --check --output ./data
  npx mydataset --filename-pattern "*.md,docs/**" --output ./docs
`);
}
