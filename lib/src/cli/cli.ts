/* eslint-disable no-console */
import { loadNpmdataConfig } from '../package/config';

import { printUsage, printVersion } from './usage';
import { runExtract } from './actions/extract';
import { runCheck } from './actions/check';
import { runList } from './actions/list';
import { runPurge } from './actions/purge';
import { runInit } from './actions/init';

const KNOWN_COMMANDS = new Set(['extract', 'check', 'list', 'purge', 'init']);

/**
 * Top-level CLI router.
 * Detects command from argv, loads config, and dispatches to appropriate handler.
 *
 * @param argv      - Process argument vector (argv[0] = node, argv[1] = script).
 * @param cwd       - Working directory for output path resolution (defaults to process.cwd()).
 * @param configCwd - Directory to search for npmdata config (defaults to cwd).
 */
export async function cli(argv: string[], cwd?: string, configCwd?: string): Promise<void> {
  const args = argv.slice(2); // strip node + script

  // Handle global --help with no command
  if (args.includes('--help') && args.length === 1) {
    printUsage();
    return;
  }

  // Handle global --version
  if (args.includes('--version')) {
    printVersion();
    return;
  }

  // Detect action
  let action: string;
  let cmdArgs: string[];

  const firstArg = args[0];
  if (firstArg && KNOWN_COMMANDS.has(firstArg)) {
    action = firstArg;
    cmdArgs = args.slice(1);
  } else {
    // Default to extract
    action = 'extract';
    cmdArgs = args;
  }

  // Load config from cwd, unless --packages is specified (CLI-only mode)
  const effectiveCwd = cwd ?? process.cwd();
  const effectiveConfigCwd = configCwd ?? effectiveCwd;
  const config = cmdArgs.includes('--packages')
    ? null // eslint-disable-line unicorn/no-null
    : await loadNpmdataConfig(effectiveConfigCwd);

  switch (action) {
    case 'extract':
      await runExtract(config, cmdArgs, effectiveCwd);
      break;
    case 'check':
      await runCheck(config, cmdArgs, effectiveCwd);
      break;
    case 'list':
      await runList(config, cmdArgs, effectiveCwd);
      break;
    case 'purge':
      await runPurge(config, cmdArgs, effectiveCwd);
      break;
    case 'init':
      await runInit(config, cmdArgs, effectiveCwd);
      break;
    default:
      throw new Error(`Unknown command: ${action}`);
  }
}
