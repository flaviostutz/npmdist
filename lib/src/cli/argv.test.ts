import { NpmdataExtractEntry } from '../types';
import { filterEntriesByPresets } from '../utils';

import { parseArgv, buildEntriesFromArgv, applyArgvOverrides } from './argv';

describe('parseArgv', () => {
  it('parses --force flag', () => {
    expect(parseArgv(['--force']).force).toBe(true);
    expect(parseArgv(['--force=true']).force).toBe(true);
    expect(parseArgv(['--force=false']).force).toBe(false);
    expect(parseArgv([]).force).toBeUndefined();
  });

  it('parses --keep-existing flag', () => {
    expect(parseArgv(['--keep-existing']).keepExisting).toBe(true);
    expect(parseArgv(['--keep-existing=false']).keepExisting).toBe(false);
    expect(parseArgv([]).keepExisting).toBeUndefined();
  });

  it('throws when --force and --keep-existing are both set', () => {
    expect(() => parseArgv(['--force', '--keep-existing'])).toThrow(
      '--force and --keep-existing are mutually exclusive',
    );
  });

  it('parses --packages as comma-split PackageConfig list', () => {
    const result = parseArgv(['--packages', 'my-pkg@^1.0.0,@scope/other@2.x']);
    expect(result.packages).toEqual([
      { name: 'my-pkg', version: '^1.0.0' },
      { name: '@scope/other', version: '2.x' },
    ]);
  });

  it('parses --output / -o', () => {
    expect(parseArgv(['--output', './out']).output).toBe('./out');
    expect(parseArgv(['-o', './out']).output).toBe('./out');
  });

  it('parses --files as comma-split', () => {
    expect(parseArgv(['--files', 'docs/**,*.md']).files).toEqual(['docs/**', '*.md']);
  });

  it('parses --content-regex as comma-split', () => {
    expect(parseArgv(['--content-regex', 'hello,world']).contentRegexes).toEqual([
      'hello',
      'world',
    ]);
  });

  it('parses --presets as comma-split', () => {
    expect(parseArgv(['--presets', 'docs,api']).presets).toEqual(['docs', 'api']);
  });

  it('parses boolean flags', () => {
    const parsed = parseArgv([
      '--dry-run',
      '--gitignore=false',
      '--managed=false',
      '--upgrade',
      '--silent',
      '--verbose',
    ]);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.gitignore).toBe(false);
    expect(parsed.managed).toBe(false);
    expect(parsed.upgrade).toBe(true);
    expect(parsed.silent).toBe(true);
    expect(parsed.verbose).toBe(true);
  });

  it('parses --gitignore and --managed flags with values', () => {
    expect(parseArgv(['--gitignore']).gitignore).toBe(true);
    expect(parseArgv(['--gitignore=true']).gitignore).toBe(true);
    expect(parseArgv(['--gitignore=false']).gitignore).toBe(false);
    expect(parseArgv([]).gitignore).toBeUndefined();
    expect(parseArgv(['--managed']).managed).toBe(true);
    expect(parseArgv(['--managed=true']).managed).toBe(true);
    expect(parseArgv(['--managed=false']).managed).toBe(false);
    expect(parseArgv([]).managed).toBeUndefined();
  });

  it('parses -v as verbose', () => {
    expect(parseArgv(['-v']).verbose).toBe(true);
  });

  it('parses --config flag', () => {
    expect(parseArgv(['--config', 'my-config.json']).configFile).toBe('my-config.json');
    expect(parseArgv(['--config', '/absolute/path/config.json']).configFile).toBe(
      '/absolute/path/config.json',
    );
    expect(parseArgv([]).configFile).toBeUndefined();
  });

  it('returns undefined for all boolean flags when none are set', () => {
    const parsed = parseArgv([]);
    expect(parsed.force).toBeUndefined();
    expect(parsed.keepExisting).toBeUndefined();
    expect(parsed.dryRun).toBeUndefined();
    expect(parsed.verbose).toBeUndefined();
    expect(parsed.gitignore).toBeUndefined();
    expect(parsed.managed).toBeUndefined();
    expect(parsed.upgrade).toBeUndefined();
    expect(parsed.silent).toBeUndefined();
  });
});

describe('buildEntriesFromArgv', () => {
  it('returns null when --packages not set', () => {
    expect(buildEntriesFromArgv(parseArgv([]))).toBeNull();
  });

  it('builds entries from --packages', () => {
    const parsed = parseArgv(['--packages', 'my-pkg@1.0.0', '--output', './out']);
    const entries = buildEntriesFromArgv(parsed);
    expect(entries).toHaveLength(1);
    expect(entries![0].package).toBe('my-pkg@1.0.0');
    expect(entries![0].output!.path).toBe('./out');
  });

  it('leaves output path undefined when --output is not set', () => {
    const parsed = parseArgv(['--packages', 'my-pkg']);
    const entries = buildEntriesFromArgv(parsed);
    expect(entries![0].output!.path).toBeUndefined();
  });
});

describe('filterEntriesByPresets', () => {
  const entries: NpmdataExtractEntry[] = [
    { package: 'pkg-a', output: { path: '.' }, selector: { presets: ['docs'] } },
    { package: 'pkg-b', output: { path: '.' }, selector: { presets: ['api', 'docs'] } },
    { package: 'pkg-c', output: { path: '.' }, selector: {} },
  ];

  it('returns all entries when no presets requested', () => {
    expect(filterEntriesByPresets(entries, [])).toHaveLength(3);
  });

  it('filters to only matching preset entries', () => {
    const result = filterEntriesByPresets(entries, ['api']);
    expect(result).toHaveLength(1);
    expect(result[0].package).toBe('pkg-b');
  });

  it('includes entries matching any of the requested presets', () => {
    const result = filterEntriesByPresets(entries, ['docs']);
    expect(result).toHaveLength(2);
  });
});

describe('applyArgvOverrides', () => {
  const baseEntry: NpmdataExtractEntry = {
    package: 'test-pkg',
    output: { path: './current', force: false },
    selector: { files: ['*.ts'] },
  };

  it('overrides output path when --output is set', () => {
    const parsed = parseArgv(['--output', './new-path', '--packages', 'test-pkg']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.path).toBe('./new-path');
  });

  it('does not override output path when --output is not set', () => {
    const parsed = parseArgv(['--packages', 'test-pkg']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.path).toBe('./current');
  });

  it('applies --force override', () => {
    const parsed = parseArgv(['--force', '--packages', 'test-pkg']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.force).toBe(true);
  });

  it('applies --keep-existing override', () => {
    const parsed = parseArgv(['--keep-existing', '--packages', 'test-pkg']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.keepExisting).toBe(true);
  });

  it('preserves config keepExisting=true when --keep-existing is not set on CLI', () => {
    const entryWithKeepExisting: NpmdataExtractEntry = {
      package: 'test-pkg',
      output: { path: './current', keepExisting: true },
      selector: {},
    };
    const parsed = parseArgv(['--packages', 'test-pkg']); // no --keep-existing
    const result = applyArgvOverrides([entryWithKeepExisting], parsed);
    expect(result[0].output!.keepExisting).toBe(true);
  });

  it('applies --gitignore=false override', () => {
    const parsed = parseArgv(['--gitignore=false', '--packages', 'test-pkg']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.gitignore).toBe(false);
  });

  it('applies --gitignore=true override', () => {
    const parsed = parseArgv(['--gitignore=true', '--packages', 'test-pkg']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.gitignore).toBe(true);
  });

  it('applies --managed=false override (sets unmanaged=true)', () => {
    const parsed = parseArgv(['--managed=false', '--packages', 'test-pkg']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.unmanaged).toBe(true);
  });

  it('applies --managed=true override (sets unmanaged=false)', () => {
    const parsed = parseArgv(['--managed=true', '--packages', 'test-pkg']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.unmanaged).toBe(false);
  });

  it('applies --dry-run override', () => {
    const parsed = parseArgv(['--dry-run', '--packages', 'test-pkg']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].output!.dryRun).toBe(true);
  });

  it('applies --files override to selector', () => {
    const parsed = parseArgv(['--files', 'docs/**', '--packages', 'test-pkg']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].selector?.files).toEqual(['docs/**']);
  });

  it('applies --content-regex override to selector', () => {
    const parsed = parseArgv(['--content-regex', 'hello', '--packages', 'test-pkg']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].selector?.contentRegexes).toEqual(['hello']);
  });

  it('applies --upgrade override to selector', () => {
    const parsed = parseArgv(['--upgrade', '--packages', 'test-pkg']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].selector?.upgrade).toBe(true);
  });

  it('applies --silent override', () => {
    const parsed = parseArgv(['--silent', '--packages', 'test-pkg']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].silent).toBe(true);
  });

  it('applies --verbose override', () => {
    const parsed = parseArgv(['--verbose', '--packages', 'test-pkg']);
    const result = applyArgvOverrides([baseEntry], parsed);
    expect(result[0].verbose).toBe(true);
  });
});
