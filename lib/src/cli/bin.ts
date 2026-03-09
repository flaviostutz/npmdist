#!/usr/bin/env node
/* eslint-disable promise/prefer-await-to-callbacks */
import { cli } from './cli';

cli(['node', 'npmdata', ...process.argv.slice(2)], process.cwd()).catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error((error as Error).message);
  process.exitCode = 1;
});
