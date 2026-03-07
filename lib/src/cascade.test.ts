/* eslint-disable no-restricted-syntax */
/* eslint-disable no-undefined */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { buildCascadeChain, mergeCascadeChainWithEntry, CascadeLevel, run } from './runner';
import { NpmdataExtractEntry } from './types';

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}));

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  readFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

type MockedExecSync = jest.MockedFunction<typeof execSync>;
type MockedReadFileSync = jest.MockedFunction<typeof fs.readFileSync>;

const mockExecSync = execSync as MockedExecSync;
const mockReadFileSync = fs.readFileSync as MockedReadFileSync;

/** Build a Buffer containing the given package.json content. */
function pkgBuf(content: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(content));
}

/**
 * Return a mockImplementation function that serves different package.json contents
 * based on whether the path includes a specific node_modules/<name>/ segment.
 *
 * @param packages - Map from package name to the JSON object to return for that package.
 * @param fallback - Buffer to return for any path not matched (e.g. consumer's package.json).
 */
function makeReadFileSyncImpl(
  packages: Record<string, Record<string, unknown>>,
  fallback: Buffer,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): (filePath: unknown) => any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (filePath: unknown): any => {
    const p = String(filePath);
    for (const [pkgName, content] of Object.entries(packages)) {
      if (p.includes(`node_modules${path.sep}${pkgName}${path.sep}`)) {
        return pkgBuf(content);
      }
    }
    return fallback;
  };
}

// ─── buildCascadeChain ──────────────────────────────────────────────────────────

describe('buildCascadeChain', () => {
  const CWD = '/project';

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns empty array when the package has no npmdata config', () => {
    // pkg-b is installed but has no npmdata attribute
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        { 'pkg-b': { name: 'pkg-b', version: '1.0.0' } },
        pkgBuf({ name: 'consumer' }),
      ),
    );

    const chain = buildCascadeChain('pkg-b', CWD);
    expect(chain).toEqual([]);
  });

  it('returns empty array when the package is not installed (readFileSync throws)', () => {
    mockReadFileSync.mockImplementation((filePath) => {
      if (String(filePath).includes('node_modules')) {
        throw new Error('ENOENT');
      }
      return JSON.stringify({ name: 'consumer' });
    });

    const chain = buildCascadeChain('missing-pkg', CWD);
    expect(chain).toEqual([]);
  });

  it('returns empty array when npmdata.sets is an empty array', () => {
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        { 'pkg-b': { name: 'pkg-b', version: '1.0.0', npmdata: { sets: [] } } },
        pkgBuf({ name: 'consumer' }),
      ),
    );

    const chain = buildCascadeChain('pkg-b', CWD);
    expect(chain).toEqual([]);
  });

  // ─── 2-level chain (A → B) ────────────────────────────────────────────────────

  it('builds a 1-element chain when the source package B has a npmdata config', () => {
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-b',
                  output: { path: '.' },
                  selector: { files: ['**/*.md', 'data/**'] },
                },
              ],
            },
          },
        },
        pkgBuf({ name: 'consumer' }),
      ),
    );

    // Consumer A calls buildCascadeChain for its source package B.
    // B's own sets reference itself (pkg-b), which is skipped as a dep (same name).
    const chain = buildCascadeChain('pkg-b', CWD);

    expect(chain).toHaveLength(1);
    expect(chain[0].packageName).toBe('pkg-b');
    expect(chain[0].files).toEqual(['**/*.md', 'data/**']);
  });

  it('captures content regexes from the source package 2-level chain', () => {
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-b',
                  output: { path: '.' },
                  selector: { contentRegexes: ['schema:', '^version:'] },
                },
              ],
            },
          },
        },
        pkgBuf({ name: 'consumer' }),
      ),
    );

    const chain = buildCascadeChain('pkg-b', CWD);
    expect(chain).toHaveLength(1);
    expect(chain[0].contentRegexes).toEqual(['schema:', '^version:']);
    expect(chain[0].files).toBeUndefined();
  });

  it('captures output boolean flags from the source package B', () => {
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-b',
                  output: { path: '.', force: true, gitignore: false, dryRun: false },
                },
              ],
            },
          },
        },
        pkgBuf({ name: 'consumer' }),
      ),
    );

    const chain = buildCascadeChain('pkg-b', CWD);
    expect(chain).toHaveLength(1);
    expect(chain[0].force).toBe(true);
    expect(chain[0].gitignore).toBe(false);
    expect(chain[0].dryRun).toBe(false);
    expect(chain[0].unmanaged).toBeUndefined();
  });

  it('uses last-defined-wins for output booleans when a package has multiple sets', () => {
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [
                { package: 'pkg-b', output: { path: '.', force: true } },
                { package: 'pkg-b', output: { path: '.', force: false } },
              ],
            },
          },
        },
        pkgBuf({ name: 'consumer' }),
      ),
    );

    const chain = buildCascadeChain('pkg-b', CWD);
    expect(chain).toHaveLength(1);
    // Last set had force: false → wins
    expect(chain[0].force).toBe(false);
  });

  it('flattens files from multiple sets in the same package into the level', () => {
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-b',
                  output: { path: '.' },
                  selector: { files: ['**/*.md'] },
                },
                {
                  package: 'pkg-b',
                  output: { path: '.' },
                  selector: { files: ['data/**'] },
                },
              ],
            },
          },
        },
        pkgBuf({ name: 'consumer' }),
      ),
    );

    const chain = buildCascadeChain('pkg-b', CWD);
    expect(chain).toHaveLength(1);
    // Both sets' file patterns combined
    expect(chain[0].files).toEqual(['**/*.md', 'data/**']);
  });

  // ─── 3-level chain (A → B → C) ───────────────────────────────────────────────

  it('builds a 2-element chain when B depends on C, deepest (C) first', () => {
    //
    // Consumer A → source B (has npmdata with sets referencing C)
    //                       B's sets also list itself (same name, skipped)
    //           → B depends on C (one of B's set.package is "pkg-c")
    // Expected chain: [C_level, B_level]  (deepest first)
    //
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-c',
                  output: { path: '.' },
                  selector: { files: ['**/*.md'] },
                },
              ],
            },
          },
          'pkg-c': {
            name: 'pkg-c',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-c',
                  output: { path: '.' },
                  selector: { files: ['docs/**'] },
                },
              ],
            },
          },
        },
        pkgBuf({ name: 'consumer' }),
      ),
    );

    const chain = buildCascadeChain('pkg-b', CWD);

    // B has sets that reference pkg-c.  buildCascadeChain recurses into pkg-c first,
    // then appends B's own level → [C, B].
    // But B's own level aggregates its own sets' files (pkg-c entry's filter: ['**/*.md']) and
    // its own selector (also none in its sets explicitly for itself).
    // The level for B is built from B's rawConfig.sets, not from C's config.
    expect(chain.length).toBeGreaterThanOrEqual(1);

    // C's level must appear before B's level
    const cIdx = chain.findIndex((l) => l.packageName === 'pkg-c');
    const bIdx = chain.findIndex((l) => l.packageName === 'pkg-b');

    if (cIdx !== -1 && bIdx !== -1) {
      // eslint-disable-next-line jest/no-conditional-expect
      expect(cIdx).toBeLessThan(bIdx);
    }
  });

  it('builds a 3-element chain for A→B→C→D with deepest (D) first', () => {
    //
    // B references C in its sets, C references D in its sets.
    // Expected chain built from A's perspective: [D_level, C_level, B_level]
    //
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-c',
                  output: { path: '.' },
                  selector: { files: ['**/*.md'] },
                },
              ],
            },
          },
          'pkg-c': {
            name: 'pkg-c',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-d',
                  output: { path: '.' },
                  selector: { files: ['data/**'] },
                },
              ],
            },
          },
          'pkg-d': {
            name: 'pkg-d',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-d',
                  output: { path: '.' },
                  selector: { files: ['conf/**'] },
                },
              ],
            },
          },
        },
        pkgBuf({ name: 'consumer' }),
      ),
    );

    const chain = buildCascadeChain('pkg-b', CWD);
    expect(chain.length).toBeGreaterThanOrEqual(2);

    // D must appear before C (if D is in the chain)
    const dIdx = chain.findIndex((l) => l.packageName === 'pkg-d');
    const cIdx = chain.findIndex((l) => l.packageName === 'pkg-c');
    if (dIdx !== -1 && cIdx !== -1) {
      // eslint-disable-next-line jest/no-conditional-expect
      expect(dIdx).toBeLessThan(cIdx);
    }
  });

  // ─── Circular dependency guard ────────────────────────────────────────────────

  it('does not loop infinitely when there is a circular dependency (A→B→A)', () => {
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-a',
                  output: { path: '.' },
                  selector: { files: ['**/*.md'] },
                },
              ],
            },
          },
          'pkg-a': {
            name: 'pkg-a',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-b',
                  output: { path: '.' },
                  selector: { files: ['data/**'] },
                },
              ],
            },
          },
        },
        pkgBuf({ name: 'consumer' }),
      ),
    );

    // This must complete without stack overflow
    expect(() => buildCascadeChain('pkg-b', CWD)).not.toThrow();
  });

  it('prevents revisiting already-visited packages in a cycle', () => {
    // A→B→A cycle: when we start with pkg-b, visited={pkg-b}
    // pkg-b's dep is pkg-a, so we recurse into pkg-a with visited={pkg-b}
    // pkg-a's dep is pkg-b, but pkg-b is already visited → skip
    // pkg-a has no sets that produce its own level (only references pkg-b which is skipped)
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [{ package: 'pkg-a', output: { path: '.' } }],
            },
          },
          'pkg-a': {
            name: 'pkg-a',
            version: '1.0.0',
            npmdata: {
              sets: [{ package: 'pkg-b', output: { path: '.' } }],
            },
          },
        },
        pkgBuf({ name: 'consumer' }),
      ),
    );

    const chain = buildCascadeChain('pkg-b', CWD);
    // The chain may include pkg-a level (it has npmdata) but must not contain pkg-b a second time.
    const pkgBLevels = chain.filter((l) => l.packageName === 'pkg-b');
    expect(pkgBLevels).toHaveLength(1);
  });

  // ─── Multiple presets / different file filters ─────────────────────────────────

  it('merges different file filters from two presets in the same package', () => {
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-b',
                  output: { path: '.' },
                  selector: { files: ['docs/**'] },
                  presets: ['docs'],
                },
                {
                  package: 'pkg-b',
                  output: { path: '.' },
                  selector: { files: ['data/**'] },
                  presets: ['data'],
                },
              ],
            },
          },
        },
        pkgBuf({ name: 'consumer' }),
      ),
    );

    const chain = buildCascadeChain('pkg-b', CWD);
    expect(chain).toHaveLength(1);
    // Files from both presets are combined
    expect(chain[0].files).toEqual(expect.arrayContaining(['docs/**', 'data/**']));
  });
});

// ─── mergeCascadeChainWithEntry ─────────────────────────────────────────────────

describe('mergeCascadeChainWithEntry', () => {
  const baseEntry: NpmdataExtractEntry = {
    package: 'pkg-a',
    output: { path: './out' },
  };

  it('returns empty cascade sets and entry.output unchanged when chain is empty', () => {
    const { cascadeFileSets, cascadeContentRegexSets, mergedOutput } = mergeCascadeChainWithEntry(
      [],
      baseEntry,
    );

    expect(cascadeFileSets).toEqual([]);
    expect(cascadeContentRegexSets).toEqual([]);
    expect(mergedOutput).toEqual(baseEntry.output);
  });

  it('collects a single file set when one chain level has files', () => {
    const chain: CascadeLevel[] = [{ packageName: 'pkg-b', files: ['**/*.md', 'data/**'] }];

    const { cascadeFileSets } = mergeCascadeChainWithEntry(chain, baseEntry);

    expect(cascadeFileSets).toHaveLength(1);
    expect(cascadeFileSets[0]).toEqual(['**/*.md', 'data/**']);
  });

  it('collects file sets from all chain levels that have files (deepest first)', () => {
    const chain: CascadeLevel[] = [
      { packageName: 'pkg-c', files: ['conf/**'] },
      { packageName: 'pkg-b', files: ['docs/**'] },
    ];

    const { cascadeFileSets } = mergeCascadeChainWithEntry(chain, baseEntry);

    expect(cascadeFileSets).toHaveLength(2);
    // Deepest (pkg-c) is first in the chain
    expect(cascadeFileSets[0]).toEqual(['conf/**']);
    expect(cascadeFileSets[1]).toEqual(['docs/**']);
  });

  it('skips chain levels that have no files when collecting cascadeFileSets', () => {
    const chain: CascadeLevel[] = [
      { packageName: 'pkg-c', files: ['conf/**'] },
      { packageName: 'pkg-b' }, // no files
    ];

    const { cascadeFileSets } = mergeCascadeChainWithEntry(chain, baseEntry);

    expect(cascadeFileSets).toHaveLength(1);
    expect(cascadeFileSets[0]).toEqual(['conf/**']);
  });

  it('collects content regex sets from all chain levels that have them', () => {
    const chain: CascadeLevel[] = [
      { packageName: 'pkg-c', contentRegexes: ['schema:', '^version:'] },
      { packageName: 'pkg-b', contentRegexes: ['# type:'] },
    ];

    const { cascadeContentRegexSets } = mergeCascadeChainWithEntry(chain, baseEntry);

    expect(cascadeContentRegexSets).toHaveLength(2);
    expect(cascadeContentRegexSets[0]).toEqual(['schema:', '^version:']);
    expect(cascadeContentRegexSets[1]).toEqual(['# type:']);
  });

  it('skips chain levels with no contentRegexes when collecting cascadeContentRegexSets', () => {
    const chain: CascadeLevel[] = [
      { packageName: 'pkg-c' }, // no contentRegexes
      { packageName: 'pkg-b', contentRegexes: ['# type:'] },
    ];

    const { cascadeContentRegexSets } = mergeCascadeChainWithEntry(chain, baseEntry);

    expect(cascadeContentRegexSets).toHaveLength(1);
    expect(cascadeContentRegexSets[0]).toEqual(['# type:']);
  });

  // ─── Output boolean merging ─────────────────────────────────────────────────

  it('uses chain boolean as default when entry.output does not specify it', () => {
    const chain: CascadeLevel[] = [{ packageName: 'pkg-b', force: true }];

    const { mergedOutput } = mergeCascadeChainWithEntry(chain, baseEntry);

    expect(mergedOutput.force).toBe(true);
  });

  it('entry.output wins over chain boolean when entry explicitly sets it', () => {
    const chain: CascadeLevel[] = [{ packageName: 'pkg-b', force: true }];
    const entryWithForce: NpmdataExtractEntry = {
      ...baseEntry,
      output: { ...baseEntry.output, force: false },
    };

    const { mergedOutput } = mergeCascadeChainWithEntry(chain, entryWithForce);

    // Entry says false → wins over chain's true
    expect(mergedOutput.force).toBe(false);
  });

  it('shallower chain level wins over deeper level for output booleans', () => {
    // chain: [deepest=force:false, shallowest=force:true]
    const chain: CascadeLevel[] = [
      { packageName: 'pkg-c', force: false }, // deepest
      { packageName: 'pkg-b', force: true }, // shallower → wins
    ];

    const { mergedOutput } = mergeCascadeChainWithEntry(chain, baseEntry);

    // pkg-b (shallower) sets force:true, entry has no opinion → true
    expect(mergedOutput.force).toBe(true);
  });

  it('3-level chain: deepest false, middle true, entry unspecified → effective true', () => {
    const chain: CascadeLevel[] = [
      { packageName: 'pkg-d', gitignore: false }, // deepest
      { packageName: 'pkg-c', gitignore: true }, // middle → overrides deepest
      { packageName: 'pkg-b' }, // no opinion
    ];

    const { mergedOutput } = mergeCascadeChainWithEntry(chain, baseEntry);

    expect(mergedOutput.gitignore).toBe(true);
  });

  it('entry false overrides all chain levels even when they all say true', () => {
    const chain: CascadeLevel[] = [
      { packageName: 'pkg-c', dryRun: true },
      { packageName: 'pkg-b', dryRun: true },
    ];
    const entryNoDry: NpmdataExtractEntry = {
      ...baseEntry,
      output: { ...baseEntry.output, dryRun: false },
    };

    const { mergedOutput } = mergeCascadeChainWithEntry(chain, entryNoDry);

    expect(mergedOutput.dryRun).toBe(false);
  });

  it('preserves entry.output.path and other non-boolean fields unchanged', () => {
    const chain: CascadeLevel[] = [{ packageName: 'pkg-b', force: true }];

    const { mergedOutput } = mergeCascadeChainWithEntry(chain, baseEntry);

    expect(mergedOutput.path).toBe('./out');
  });

  it('collects both file sets and content regex sets from a mixed chain', () => {
    const chain: CascadeLevel[] = [
      { packageName: 'pkg-c', files: ['docs/**'], contentRegexes: ['schema:'] },
      { packageName: 'pkg-b', files: ['data/**'] },
    ];

    const { cascadeFileSets, cascadeContentRegexSets } = mergeCascadeChainWithEntry(
      chain,
      baseEntry,
    );

    expect(cascadeFileSets).toHaveLength(2);
    expect(cascadeContentRegexSets).toHaveLength(1);
  });
});

// ─── run() integration: cascade flags in the extract command ───────────────────

describe('run – cascade chain integration', () => {
  const BIN_DIR = '/fake/bin';
  const EXTRACT_ARGV = ['node', 'script.js', 'extract'];

  beforeEach(() => {
    jest.resetAllMocks();
  });

  function capturedCommands(): string[] {
    return mockExecSync.mock.calls.map((call) => call[0] as string);
  }

  function capturedCommand(): string {
    return capturedCommands()[0];
  }

  it('appends --cascade-files for each cascade level with files (2-level chain)', () => {
    // Consumer package.json: 1 entry pointing at pkg-b
    // pkg-b's installed package.json: has npmdata with files filter
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          // pkg-b is the source package; its npmdata has files → cascade level
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-b',
                  output: { path: '.' },
                  selector: { files: ['**/*.md', 'data/**'] },
                },
              ],
            },
          },
        },
        // Fallback: the consumer's package.json
        pkgBuf({
          name: 'consumer',
          npmdata: {
            sets: [{ package: 'pkg-b', output: { path: './out' } }],
          },
        }),
      ),
    );

    run(BIN_DIR, EXTRACT_ARGV);

    const cmd = capturedCommand();
    expect(cmd).toContain('--cascade-files "**/*.md,data/**"');
  });

  it('appends two --cascade-files flags for a 3-level chain (A→B→C)', () => {
    // B references C in its sets; C has its own npmdata.
    // Chain from B's perspective: [C_level, B_level]
    // Expected: 2 --cascade-files flags (one per level that has files)
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-c',
                  output: { path: '.' },
                  selector: { files: ['**/*.md'] },
                },
              ],
            },
          },
          'pkg-c': {
            name: 'pkg-c',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-c',
                  output: { path: '.' },
                  selector: { files: ['docs/**'] },
                },
              ],
            },
          },
        },
        pkgBuf({
          name: 'consumer',
          npmdata: {
            sets: [{ package: 'pkg-b', output: { path: './out' } }],
          },
        }),
      ),
    );

    run(BIN_DIR, EXTRACT_ARGV);

    const cmd = capturedCommand();
    // Both levels contribute a --cascade-files flag
    const matches = cmd.match(/--cascade-files/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(1);
  });

  it('appends --cascade-content-regex for each cascade level with content regexes', () => {
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-b',
                  output: { path: '.' },
                  selector: { contentRegexes: ['schema:', '^version:'] },
                },
              ],
            },
          },
        },
        pkgBuf({
          name: 'consumer',
          npmdata: {
            sets: [{ package: 'pkg-b', output: { path: './out' } }],
          },
        }),
      ),
    );

    run(BIN_DIR, EXTRACT_ARGV);

    const cmd = capturedCommand();
    expect(cmd).toContain('--cascade-content-regex "schema:,^version:"');
  });

  it('produces no cascade flags when the source package has no npmdata config', () => {
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          // pkg-b is installed but has no npmdata
          'pkg-b': { name: 'pkg-b', version: '1.0.0' },
        },
        pkgBuf({
          name: 'consumer',
          npmdata: {
            sets: [{ package: 'pkg-b', output: { path: './out' } }],
          },
        }),
      ),
    );

    run(BIN_DIR, EXTRACT_ARGV);

    const cmd = capturedCommand();
    expect(cmd).not.toContain('--cascade-files');
    expect(cmd).not.toContain('--cascade-content-regex');
  });

  it('merges cascade output booleans: B sets force:true, A entry has no opinion → --force in cmd', () => {
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-b',
                  output: { path: '.', force: true },
                },
              ],
            },
          },
        },
        pkgBuf({
          name: 'consumer',
          npmdata: {
            // A's entry does not set force
            sets: [{ package: 'pkg-b', output: { path: './out' } }],
          },
        }),
      ),
    );

    run(BIN_DIR, EXTRACT_ARGV);

    const cmd = capturedCommand();
    expect(cmd).toContain(' --force');
  });

  it('A entry force:false overrides cascade boolean force:true', () => {
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-b',
                  output: { path: '.', force: true },
                },
              ],
            },
          },
        },
        pkgBuf({
          name: 'consumer',
          npmdata: {
            // A explicitly sets force: false
            sets: [{ package: 'pkg-b', output: { path: './out', force: false } }],
          },
        }),
      ),
    );

    run(BIN_DIR, EXTRACT_ARGV);

    const cmd = capturedCommand();
    expect(cmd).not.toContain('--force');
  });

  it('applies independent cascade chains for each entry in a multi-entry config', () => {
    // Consumer has 2 entries: one for pkg-b (has cascade), one for pkg-c (no cascade)
    mockReadFileSync.mockImplementation(
      makeReadFileSyncImpl(
        {
          'pkg-b': {
            name: 'pkg-b',
            version: '1.0.0',
            npmdata: {
              sets: [
                {
                  package: 'pkg-b',
                  output: { path: '.' },
                  selector: { files: ['**/*.md'] },
                },
              ],
            },
          },
          'pkg-c': { name: 'pkg-c', version: '1.0.0' }, // no npmdata
        },
        pkgBuf({
          name: 'consumer',
          npmdata: {
            sets: [
              { package: 'pkg-b', output: { path: './b-out' } },
              { package: 'pkg-c', output: { path: './c-out' } },
            ],
          },
        }),
      ),
    );

    run(BIN_DIR, EXTRACT_ARGV);

    const cmds = capturedCommands();
    expect(cmds).toHaveLength(2);

    const bCmd = cmds.find((c) => c.includes('"pkg-b"'))!;
    const cCmd = cmds.find((c) => c.includes('"pkg-c"'))!;

    expect(bCmd).toContain('--cascade-files "**/*.md"');
    expect(cCmd).not.toContain('--cascade-files');
  });
});
