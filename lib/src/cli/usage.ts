/* eslint-disable no-console */

const VERSION = '2.0.0';

/**
 * Print usage/help text for the given command to stdout.
 */
export function printUsage(command?: string): void {
  const cmd = command ?? 'extract';

  switch (cmd) {
    case 'extract':
      console.log(`
Usage: npmdata [extract] [options]

Extract files from one or more npm packages into a local output directory.

Options:
  --packages <specs>      Comma-separated package specs (e.g. my-pkg@^1.2.3). Overrides config sets.
  --output, -o <dir>      Output directory path. Required when --packages is used.
  --files <globs>         Comma-separated glob patterns for file selection.
  --content-regex <re>    Comma-separated regex strings for content filtering.
  --force                 Overwrite existing unmanaged files.
  --keep-existing         Skip files that already exist; create missing ones.
  --no-gitignore          Disable .gitignore update alongside each marker.
  --unmanaged             Write without .npmdata marker; no gitignore; no read-only.
  --dry-run               Report changes without writing to disk.
  --upgrade               Force fresh package install even if satisfying version installed.
  --presets <tags>        Comma-separated preset tags; only matching entries are processed.
  --config <file>         Path to a config file (overrides auto-discovered .npmdatarc / package.json).
  --silent                Suppress per-file output; print only final summary line.
  --verbose, -v           Print detailed step information.
  --help                  Print this help text.
  --version               Print version.

Exit codes: 0 success | 1 error
`);
      break;

    case 'check':
      console.log(`
Usage: npmdata check [options]

Verify that locally extracted files match their package sources.

Options:
  --packages <specs>      Comma-separated package specs. Overrides config sets.
  --output, -o <dir>      Output directory path.
  --files <globs>         Glob patterns for file selection.
  --content-regex <re>    Regex strings for content filtering.
  --unmanaged             Silently skip unmanaged entries.
  --presets <tags>        Comma-separated preset tags; only matching entries are checked.
  --config <file>         Path to a config file (overrides auto-discovered .npmdatarc / package.json).
  --verbose, -v           Print detailed comparison information.
  --help                  Print this help text.

Exit codes: 0 all in sync | 1 drift detected or error
`);
      break;

    case 'list':
      console.log(`
Usage: npmdata list [options]

Print all files currently managed by npmdata in the output directory.

Options:
  --output, -o <dir>      Output directory to inspect.
  --config <file>         Path to a config file (overrides auto-discovered .npmdatarc / package.json).
  --verbose, -v           Print additional metadata per file.
  --help                  Print this help text.

Output format: <relPath>  <packageName>@<packageVersion>
Exit codes: 0 always
`);
      break;

    case 'purge':
      console.log(`
Usage: npmdata purge [options]

Remove all managed files from the output directory.

Options:
  --packages <specs>      Comma-separated package specs. Limits purge to matching entries.
  --output, -o <dir>      Output directory to purge.
  --presets <tags>        Comma-separated preset tags; only matching entries are purged.
  --dry-run               Print what would be removed without deleting.
  --config <file>         Path to a config file (overrides auto-discovered .npmdatarc / package.json).
  --silent                Suppress per-file output.
  --verbose, -v           Print detailed deletion steps.
  --help                  Print this help text.

Exit codes: 0 purge complete | 1 error during deletion
`);
      break;

    case 'init':
      console.log(`
Usage: npmdata init [options]

Scaffold a new publishable npm data package.

Options:
  --output, -o <dir>      Directory to scaffold into (default: current dir).
  --verbose, -v           Print scaffolding steps.
  --help                  Print this help text.

Created files: package.json, bin/npmdata.js
Exit codes: 0 success | 1 target dir has conflicting files
`);
      break;

    case 'presets':
      console.log(`
Usage: npmdata presets

List all unique preset tags defined in the configuration.
Presets are declared in each entry's "presets" field and can be used
to selectively run extract, check, list, or purge via --presets <tag>.

Options:
  --config <file>         Path to a config file (overrides auto-discovered .npmdatarc / package.json).
  --help                  Print this help text.

Output format: one preset per line, sorted alphabetically
Exit codes: 0 success | 1 no configuration found
`);
      break;

    default:
      console.log(`
Usage: npmdata [command] [options]

Commands:
  extract (default)  Extract files from npm packages
  check              Verify extracted files match package sources
  list               List all managed files
  purge              Remove managed files
  init               Scaffold a publishable data package
  presets            List all preset tags defined in configuration

Run 'npmdata <command> --help' for command-specific help.
Version: ${VERSION}
`);
  }
}

export function printVersion(): void {
  // Try to read version from package.json
  console.log(`npmdata v${VERSION}`);
}
