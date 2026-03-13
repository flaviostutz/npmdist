/* eslint-disable no-undefined */
import { PackageConfig, NpmdataExtractEntry, SelectorConfig, OutputConfig } from '../types';
import { parsePackageSpec } from '../utils';

/**
 * Parsed CLI flags for all commands.
 * All flags are undefined when not supplied on the command line;
 * defaults are applied downstream in the library.
 */
export type ParsedArgv = {
  packages?: PackageConfig[];
  output?: string;
  files?: string[];
  contentRegexes?: string[];
  presets?: string[];
  configFile?: string;
  force?: boolean;
  keepExisting?: boolean;
  /** --gitignore / --gitignore=true|false */
  gitignore?: boolean;
  /** --managed / --managed=true|false  (false ≡ unmanaged mode) */
  managed?: boolean;
  dryRun?: boolean;
  upgrade?: boolean;
  silent?: boolean;
  verbose?: boolean;
};

/**
 * Parse all supported CLI flags from an argv array.
 * Validates mutually exclusive combinations and throws on invalid input.
 */
export function parseArgv(argv: string[]): ParsedArgv {
  const getBoolFlag = (flag: string): boolean | undefined => {
    for (const arg of argv) {
      if (arg === flag) return true;
      if (arg === `${flag}=true`) return true;
      if (arg === `${flag}=false`) return false;
    }

    return undefined;
  };
  const getValue = (flag: string, shortFlag?: string): string | undefined => {
    const idx = argv.findIndex((a) => a === flag || (shortFlag !== undefined && a === shortFlag));
    if (idx === -1 || idx + 1 >= argv.length) {
      return undefined;
    }
    return argv[idx + 1];
  };
  const getCommaSplit = (flag: string, shortFlag?: string): string[] | undefined => {
    const val = getValue(flag, shortFlag);

    if (val === undefined) {
      return undefined;
    }
    return val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const force = getBoolFlag('--force');
  const keepExisting = getBoolFlag('--keep-existing');

  if (force === true && keepExisting === true) {
    throw new Error('--force and --keep-existing are mutually exclusive');
  }

  const packagesRaw = getCommaSplit('--packages');
  const packages = packagesRaw?.map((s) => parsePackageSpec(s));

  const verboseFlag = getBoolFlag('--verbose');

  return {
    packages,
    output: getValue('--output', '-o'),
    files: getCommaSplit('--files'),
    contentRegexes: getCommaSplit('--content-regex'),
    presets: getCommaSplit('--presets'),
    configFile: getValue('--config'),
    force,
    keepExisting,
    gitignore: getBoolFlag('--gitignore'),
    managed: getBoolFlag('--managed'),
    dryRun: getBoolFlag('--dry-run'),
    upgrade: getBoolFlag('--upgrade'),
    silent: getBoolFlag('--silent'),
    verbose: argv.includes('-v') ? true : verboseFlag,
  };
}

/**
 * Build NpmdataExtractEntry objects from --packages + --output CLI flags.
 * Returns null if --packages is not set.
 */
export function buildEntriesFromArgv(parsed: ParsedArgv): NpmdataExtractEntry[] | null {
  if (!parsed.packages || parsed.packages.length === 0) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }

  const selector: SelectorConfig = {};
  if (parsed.files) selector.files = parsed.files;
  if (parsed.contentRegexes) selector.contentRegexes = parsed.contentRegexes;
  // In ad-hoc --packages mode there is no entry-level presets tag, so we place
  // --presets into selector.presets. filterEntriesByPresets checks both fields,
  // which keeps --presets filtering working in this mode.
  // selector.presets is also forwarded to the target package's nested set extraction.
  if (parsed.presets) selector.presets = parsed.presets;

  if (parsed.upgrade !== undefined) selector.upgrade = parsed.upgrade;

  const output: OutputConfig = {
    ...(parsed.output !== undefined ? { path: parsed.output } : {}),
    ...(parsed.force !== undefined ? { force: parsed.force } : {}),
    ...(parsed.keepExisting !== undefined ? { keepExisting: parsed.keepExisting } : {}),
    ...(parsed.gitignore !== undefined ? { gitignore: parsed.gitignore } : {}),
    ...(parsed.managed !== undefined ? { unmanaged: parsed.managed === false } : {}),
    ...(parsed.dryRun !== undefined ? { dryRun: parsed.dryRun } : {}),
  };

  return parsed.packages.map((pkg) => ({
    package: pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name,
    output,
    selector,
    ...(parsed.silent !== undefined ? { silent: parsed.silent } : {}),
    ...(parsed.verbose !== undefined ? { verbose: parsed.verbose } : {}),
  }));
}

/**
 * Apply CLI overrides from ParsedArgv to each NpmdataExtractEntry.
 * CLI flags always take precedence over config file values.
 */
export function applyArgvOverrides(
  entries: NpmdataExtractEntry[],
  parsed: ParsedArgv,
): NpmdataExtractEntry[] {
  return entries.map((entry) => {
    const updatedOutput: OutputConfig = {
      ...entry.output,

      ...(parsed.output !== undefined ? { path: parsed.output } : {}),
      ...(parsed.force !== undefined ? { force: parsed.force } : {}),
      ...(parsed.keepExisting !== undefined ? { keepExisting: parsed.keepExisting } : {}),
      ...(parsed.gitignore !== undefined ? { gitignore: parsed.gitignore } : {}),
      ...(parsed.managed !== undefined ? { unmanaged: parsed.managed === false } : {}),
      ...(parsed.dryRun !== undefined ? { dryRun: parsed.dryRun } : {}),
    };

    const updatedSelector: SelectorConfig = {
      ...entry.selector,
      ...(parsed.files ? { files: parsed.files } : {}),
      ...(parsed.contentRegexes ? { contentRegexes: parsed.contentRegexes } : {}),
      ...(parsed.upgrade !== undefined ? { upgrade: parsed.upgrade } : {}),
    };

    return {
      ...entry,
      output: updatedOutput,
      selector: updatedSelector,
      ...(parsed.silent !== undefined ? { silent: parsed.silent } : {}),
      ...(parsed.verbose !== undefined ? { verbose: parsed.verbose } : {}),
    };
  });
}
