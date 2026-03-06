#!/usr/bin/env node
/**
 * Example post-extract script for the project-using-config-file example.
 *
 * npmdata calls this script after a successful extract action, appending the
 * full command-line arguments (action + flags) so the script can inspect them.
 *
 * The script is executed with its cwd set to the effective output base directory
 * (the value of --output, or process.cwd() when --output is not supplied).
 *
 * This example reads the output directory from the --output / -o flag passed
 * by npmdata, logs all received parameters, and writes a "lastUpdated" file
 * inside that directory recording the ISO timestamp of the last successful extraction.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
console.log('Post-extract: received parameters:', args);

// Parse --output / -o from the arguments passed by npmdata
function parseOutput(argv) {
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--output' || argv[i] === '-o') && i + 1 < argv.length) {
      return argv[i + 1];
    }
  }
  return undefined;
}

const parsedOutput = parseOutput(args);
const baseDir = parsedOutput ? path.resolve(parsedOutput) : process.cwd();
const outputDir = path.join(baseDir, 'output');
const file = path.join(outputDir, 'lastUpdated');

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(file, new Date().toISOString() + '\n');

console.log(`Post-extract: wrote ${path.relative(process.cwd(), file)}`);
