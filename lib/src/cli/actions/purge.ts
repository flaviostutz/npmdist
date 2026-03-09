/* eslint-disable no-console */
import { NpmdataConfig } from '../../types';
import { parseArgv, buildEntriesFromArgv } from '../argv';
import { printUsage } from '../usage';
import { actionPurge } from '../../package/action-purge';

/**
 * `purge` CLI action handler.
 */
export async function runPurge(
  config: NpmdataConfig | null,
  argv: string[],
  cwd: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('purge');
    return;
  }

  const parsed = parseArgv(argv);

  const entries = buildEntriesFromArgv(parsed) ?? config?.sets ?? [];

  const summary = await actionPurge({
    entries,
    config,
    cwd,
    presets: parsed.presets ?? [],
    dryRun: parsed.dryRun,
    verbose: parsed.verbose,
    onProgress: (event: import('../../types').ProgressEvent) => {
      if (parsed.silent) return;
      if (event.type === 'file-deleted') console.log(`  - ${event.file}`);
    },
  });

  console.log(`Purge complete: ${summary.deleted} deleted.`);
}
