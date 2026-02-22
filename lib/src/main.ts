#!/usr/bin/env node

import { cli } from './cli';

// eslint-disable-next-line no-void
void (async (): Promise<void> => {
  process.on('uncaughtException', (err) => {
    const errs = `${err}`;
    let i = errs.indexOf('\n');
    if (i === -1) i = errs.length;
    console.log(errs.slice(0, Math.max(0, i)));
    process.exit(3);
  });
  const exitCode = await cli(process.argv);
  process.exit(exitCode);
})();