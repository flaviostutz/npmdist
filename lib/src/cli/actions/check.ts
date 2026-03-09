/* eslint-disable no-console */
import { NpmdataConfig } from '../../types';
import { parseArgv, applyArgvOverrides, buildEntriesFromArgv } from '../argv';
import { printUsage } from '../usage';
import { actionCheck } from '../../package/action-check';

/**
 * `check` CLI action handler.
 */
export async function runCheck(
  config: NpmdataConfig | null,
  argv: string[],
  cwd: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('check');
    return;
  }

  const parsed = parseArgv(argv);

  // Build entries: --packages overrides config sets
  let entries = buildEntriesFromArgv(parsed);
  if (!entries) {
    if (!config || config.sets.length === 0) {
      throw new Error(
        'No packages specified during check. Use --packages or a config file with sets.',
      );
    }
    entries = applyArgvOverrides(config.sets, parsed);
  }

  const summary = await actionCheck({
    entries,
    config,
    cwd,
    verbose: parsed.verbose,
    skipUnmanaged: parsed.unmanaged,
  });

  const hasDrift =
    summary.missing.length > 0 || summary.modified.length > 0 || summary.extra.length > 0;

  if (hasDrift) {
    for (const f of summary.missing) console.log(`missing: ${f}`);
    for (const f of summary.modified) console.log(`modified: ${f}`);
    for (const f of summary.extra) console.log(`extra: ${f}`);
    process.exitCode = 1;
  } else {
    console.log('All managed files are in sync.');
  }
}
