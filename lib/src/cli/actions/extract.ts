/* eslint-disable no-console */
import { execSync } from 'node:child_process';

import { NpmdataConfig, ProgressEvent } from '../../types';
import { parseArgv, buildEntriesFromArgv, applyArgvOverrides } from '../argv';
import { printUsage } from '../usage';
import { actionExtract } from '../../package/action-extract';
import { filterEntriesByPresets } from '../../utils';

/**
 * `extract` CLI action handler.
 * Parses argv, merges with config, calls actionExtract, prints summary.
 */
export async function runExtract(
  config: NpmdataConfig | null,
  argv: string[],
  cwd: string,
): Promise<void> {
  if (argv.includes('--help')) {
    printUsage('extract');
    return;
  }

  const parsed = parseArgv(argv);

  // Build entries: --packages overrides config sets
  let entries = buildEntriesFromArgv(parsed);
  if (!entries) {
    if (!config || config.sets.length === 0) {
      throw new Error(
        'No packages specified during extract. Use --packages or a config file with sets.',
      );
    }
    // Config-sourced entries need CLI flag overrides applied
    entries = applyArgvOverrides(config.sets, parsed);
  }

  // Apply preset filter
  const presets = parsed.presets ?? [];
  const filtered = filterEntriesByPresets(entries, presets);

  if (filtered.length === 0) {
    console.log('No entries matched the specified presets.');
    return;
  }

  const result = await actionExtract({
    entries: filtered,
    config,
    cwd,
    verbose: parsed.verbose,
    onProgress: (event: ProgressEvent) => {
      if (filtered[0]?.silent) return;
      if (event.type === 'file-added') console.log(`  + ${event.file}`);
      else if (event.type === 'file-modified') console.log(`  ~ ${event.file}`);
      else if (event.type === 'file-deleted') console.log(`  - ${event.file}`);
    },
  });

  // Run postExtractScript if configured and not dry-run
  const isDryRun = filtered.some((e) => e.output.dryRun);
  if (!isDryRun && config?.postExtractScript) {
    const scriptCmd = `${config.postExtractScript} ${argv.join(' ')}`.trim();
    try {
      execSync(scriptCmd, { cwd, stdio: 'inherit', encoding: 'utf8' });
    } catch (error: unknown) {
      const e = error as { status?: number };
      throw new Error(`Post-extract script failed with exit code ${e.status ?? 1}`);
    }
  }

  console.log(
    `Extract complete: ${result.added} added, ${result.modified} modified, ` +
      `${result.deleted} deleted, ${result.skipped} skipped.`,
  );
}
