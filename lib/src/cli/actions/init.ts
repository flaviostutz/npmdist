/* eslint-disable no-console */
import path from 'node:path';

import { NpmdataConfig } from '../../types';
import { parseArgv } from '../argv';
import { printUsage } from '../usage';
import { actionInit } from '../../package/action-init';

/**
 * `init` CLI action handler.
 */
export async function runInit(
  config: NpmdataConfig | null,
  argv: string[],
  cwd: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('init');
    return;
  }

  const parsed = parseArgv(argv);
  const outputDir = parsed.output ? path.resolve(cwd, parsed.output) : cwd;
  const { verbose, files, packages } = parsed;

  const initConfig = {
    files,
    packages: packages?.map((p) => (p.version ? `${p.name}@${p.version}` : p.name)),
  };

  await actionInit(outputDir, verbose, initConfig);
  console.log('Init complete. Scaffolded package.json and bin/npmdata.js.');
}
