import { PackageConfig, NpmdataExtractEntry, SelectorConfig, OutputConfig } from '../types';
import { parsePackageSpec } from '../utils';

/**
 * Parsed CLI flags for all commands.
 */
export type ParsedArgv = {
  packages?: PackageConfig[];
  output?: string;
  files?: string[];
  contentRegexes?: string[];
  presets?: string[];
  configFile?: string;
  force: boolean;
  keepExisting: boolean;
  noGitignore: boolean;
  unmanaged: boolean;
  dryRun: boolean;
  upgrade: boolean;
  silent: boolean;
  verbose: boolean;
};

/**
 * Parse all supported CLI flags from an argv array.
 * Validates mutually exclusive combinations and throws on invalid input.
 */
export function parseArgv(argv: string[]): ParsedArgv {
  const getFlag = (flag: string): boolean => argv.includes(flag);
  const getValue = (flag: string, shortFlag?: string): string | undefined => {
    // eslint-disable-next-line no-undefined
    const idx = argv.findIndex((a) => a === flag || (shortFlag !== undefined && a === shortFlag));
    if (idx === -1 || idx + 1 >= argv.length) {
      // eslint-disable-next-line no-undefined
      return undefined;
    }
    return argv[idx + 1];
  };
  const getCommaSplit = (flag: string, shortFlag?: string): string[] | undefined => {
    const val = getValue(flag, shortFlag);
    // eslint-disable-next-line no-undefined
    if (val === undefined) {
      // eslint-disable-next-line no-undefined
      return undefined;
    }
    return val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const force = getFlag('--force');
  const keepExisting = getFlag('--keep-existing');

  if (force && keepExisting) {
    throw new Error('--force and --keep-existing are mutually exclusive');
  }

  const packagesRaw = getCommaSplit('--packages');
  const packages = packagesRaw?.map((s) => parsePackageSpec(s));

  return {
    packages,
    output: getValue('--output', '-o'),
    files: getCommaSplit('--files'),
    contentRegexes: getCommaSplit('--content-regex'),
    presets: getCommaSplit('--presets'),
    configFile: getValue('--config'),
    force,
    keepExisting,
    noGitignore: getFlag('--no-gitignore'),
    unmanaged: getFlag('--unmanaged'),
    dryRun: getFlag('--dry-run'),
    upgrade: getFlag('--upgrade'),
    silent: getFlag('--silent'),
    verbose: getFlag('--verbose') || getFlag('-v'),
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
  if (parsed.upgrade) selector.upgrade = true;

  const output: OutputConfig = {
    path: parsed.output ?? '.',
    force: parsed.force,
    keepExisting: parsed.keepExisting,
    gitignore: !parsed.noGitignore,
    unmanaged: parsed.unmanaged,
    dryRun: parsed.dryRun,
  };

  return parsed.packages.map((pkg) => ({
    package: pkg.version ? `${pkg.name}@${pkg.version}` : pkg.name,
    output,
    selector,
    silent: parsed.silent,
    verbose: parsed.verbose,
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
      // eslint-disable-next-line no-undefined
      ...(parsed.output !== undefined ? { path: parsed.output } : {}),
      ...(parsed.force ? { force: true } : {}),
      ...(parsed.keepExisting ? { keepExisting: true } : {}),
      ...(parsed.noGitignore ? { gitignore: false } : {}),
      ...(parsed.unmanaged ? { unmanaged: true } : {}),
      ...(parsed.dryRun ? { dryRun: true } : {}),
    };

    const updatedSelector: SelectorConfig = {
      ...entry.selector,
      ...(parsed.files ? { files: parsed.files } : {}),
      ...(parsed.contentRegexes ? { contentRegexes: parsed.contentRegexes } : {}),
      ...(parsed.upgrade ? { upgrade: true } : {}),
    };

    return {
      ...entry,
      output: updatedOutput,
      selector: updatedSelector,
      ...(parsed.silent ? { silent: true } : {}),
      ...(parsed.verbose ? { verbose: true } : {}),
    };
  });
}
