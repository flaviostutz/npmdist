import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { jest } from '@jest/globals';

import { installMockPackage } from '../fileset/test-utils';
import { NpmdataExtractEntry } from '../types';
import { writeMarker, markerPath } from '../fileset/markers';

import { actionCheck } from './action-check';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npmdata-action-check-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('actionCheck', () => {
  it('returns empty summary when entries array is empty', async () => {
    const result = await actionCheck({ entries: [], cwd: tmpDir });
    expect(result.missing).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });

  it('returns empty summary when files match source', async () => {
    await installMockPackage('check-action-pkg', '1.0.0', { 'README.md': '# OK' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'README.md'), '# OK');

    const markerFile = markerPath(outputDir);
    fs.mkdirSync(path.dirname(markerFile), { recursive: true });
    await writeMarker(markerFile, [
      { path: 'README.md', packageName: 'check-action-pkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'check-action-pkg@1.0.0', output: { path: outputDir } },
    ];

    const result = await actionCheck({ entries, cwd: tmpDir });
    expect(result.missing).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  }, 60000);

  it('reports missing when package not installed', async () => {
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });

    // Write a marker for a file
    const markerFile = markerPath(outputDir);
    await writeMarker(markerFile, [
      { path: 'src/index.ts', packageName: 'nonexistent-pkg', packageVersion: '1.0.0' },
    ]);
    fs.mkdirSync(path.join(outputDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'src/index.ts'), 'x');

    const entries: NpmdataExtractEntry[] = [
      { package: 'nonexistent-pkg', output: { path: outputDir } },
    ];

    const result = await actionCheck({ entries, cwd: tmpDir });
    // nonexistent-pkg is not installed → all marker entries go to missing
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('skips unmanaged entries when skipUnmanaged=true', async () => {
    const entries: NpmdataExtractEntry[] = [
      { package: 'some-pkg', output: { path: path.join(tmpDir, 'out'), unmanaged: true } },
    ];

    const result = await actionCheck({ entries, cwd: tmpDir, skipUnmanaged: true });
    expect(result.missing).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });

  it('aggregates results from multiple entries', async () => {
    await installMockPackage('multi-pkg', '1.0.0', { 'a.md': 'aaa' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outputDir, { recursive: true });
    // Don't extract the file → it will be "modified" (hash mismatch) or "missing"

    // Write a marker entry with wrong hash (will cause modified detection)
    const markerFile = markerPath(outputDir);
    await writeMarker(markerFile, [
      { path: 'a.md', packageName: 'multi-pkg', packageVersion: '1.0.0' },
    ]);
    // Write the file with different content
    fs.writeFileSync(path.join(outputDir, 'a.md'), 'different content');

    const entries: NpmdataExtractEntry[] = [
      { package: 'multi-pkg@1.0.0', output: { path: outputDir } },
    ];

    const result = await actionCheck({ entries, cwd: tmpDir });
    // Since hash differs, should be in modified
    expect(result.modified).toContain('a.md');
  }, 60000);

  it('emits onProgress events', async () => {
    const events: string[] = [];
    const entries: NpmdataExtractEntry[] = [
      { package: 'nonexistent-pkg@1.0.0', output: { path: path.join(tmpDir, 'out') } },
    ];

    await actionCheck({
      entries,
      cwd: tmpDir,
      onProgress: (e) => events.push(e.type),
    });

    expect(events).toContain('package-start');
  });

  it('uses "latest" when package spec has no version', async () => {
    await installMockPackage('no-version-pkg', '2.0.0', { 'a.txt': 'hello' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out-nv');
    fs.mkdirSync(outputDir, { recursive: true });

    const markerFile = markerPath(outputDir);
    await writeMarker(markerFile, [
      { path: 'a.txt', packageName: 'no-version-pkg', packageVersion: '2.0.0' },
    ]);
    fs.writeFileSync(path.join(outputDir, 'a.txt'), 'hello');

    const events: Array<{ type: string; version?: string }> = [];
    const entries: NpmdataExtractEntry[] = [
      // No version specified → should use 'latest' in progress events
      { package: 'no-version-pkg', output: { path: outputDir } },
    ];

    await actionCheck({
      entries,
      cwd: tmpDir,
      onProgress: (e) => {
        if ('packageVersion' in e) {
          events.push({ type: e.type, version: e.packageVersion });
        }
      },
    });

    // Should emit package-end with 'latest' since no version was in spec
    const endEvent = events.find((e) => e.type === 'package-end');
    expect(endEvent).toBeDefined();
    expect(endEvent?.version).toBe('latest');
  }, 60000);

  it('uses provided selector when checking', async () => {
    await installMockPackage('sel-pkg', '1.0.0', { 'docs/api.md': '# API' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out-sel');
    fs.mkdirSync(outputDir, { recursive: true });

    const markerFile = markerPath(outputDir);
    await writeMarker(markerFile, [
      { path: 'docs/api.md', packageName: 'sel-pkg', packageVersion: '1.0.0' },
    ]);
    fs.mkdirSync(path.join(outputDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'docs/api.md'), '# API');

    const entries: NpmdataExtractEntry[] = [
      {
        package: 'sel-pkg@1.0.0',
        selector: { files: ['**'] },
        output: { path: outputDir },
      },
    ];

    const result = await actionCheck({ entries, cwd: tmpDir });
    // With selector matching all files, should be clean
    expect(result.modified).toHaveLength(0);
  }, 60000);

  it('presets option filters which entries are checked', async () => {
    await installMockPackage('presets-docs-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);
    await installMockPackage('presets-data-pkg', '1.0.0', { 'data/sample.csv': 'a,b' }, tmpDir);

    const docsOutput = path.join(tmpDir, 'out-docs');
    const dataOutput = path.join(tmpDir, 'out-data');

    // Set up marker and matching files for both packages so check passes when run
    fs.mkdirSync(path.join(docsOutput, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(docsOutput, 'docs/guide.md'), '# Guide');
    await writeMarker(markerPath(docsOutput), [
      { path: 'docs/guide.md', packageName: 'presets-docs-pkg', packageVersion: '1.0.0' },
    ]);

    fs.mkdirSync(path.join(dataOutput, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dataOutput, 'data/sample.csv'), 'a,b');
    await writeMarker(markerPath(dataOutput), [
      { path: 'data/sample.csv', packageName: 'presets-data-pkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'presets-docs-pkg@1.0.0', output: { path: docsOutput }, presets: ['docs'] },
      { package: 'presets-data-pkg@1.0.0', output: { path: dataOutput }, presets: ['data'] },
    ];

    // Check with presets=['docs'] — only the docs entry is checked
    const resultDocs = await actionCheck({ entries, cwd: tmpDir, presets: ['docs'] });
    expect(resultDocs.missing).toHaveLength(0);
    expect(resultDocs.modified).toHaveLength(0);
    expect(resultDocs.extra).toHaveLength(0);

    // Delete the data file — with presets=['docs'] it is ignored
    fs.rmSync(path.join(dataOutput, 'data/sample.csv'));
    const resultDocsOnly = await actionCheck({
      entries,
      cwd: tmpDir,
      presets: ['docs'],
    });
    // data entry was filtered out, so missing data file is not reported
    expect(resultDocsOnly.missing).toHaveLength(0);

    // Now check with presets=['data'] — the missing data file should be reported
    const resultData = await actionCheck({
      entries,
      cwd: tmpDir,
      presets: ['data'],
    });
    expect(resultData.missing).toContain('data/sample.csv');
  }, 60000);

  it('presets=[] checks all entries', async () => {
    await installMockPackage('all-presets-pkg', '1.0.0', { 'file.md': '# File' }, tmpDir);

    const outputDir = path.join(tmpDir, 'out-all');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'file.md'), '# File');
    await writeMarker(markerPath(outputDir), [
      { path: 'file.md', packageName: 'all-presets-pkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'all-presets-pkg@1.0.0', output: { path: outputDir }, presets: ['some-tag'] },
    ];

    // presets=[] means no filtering — all entries pass through
    const result = await actionCheck({ entries, cwd: tmpDir, presets: [] });
    expect(result.missing).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  }, 60000);

  it('recursively checks transitive packages declared in npmdata.sets', async () => {
    // Parent package installed in node_modules with npmdata.sets pointing at a child
    const parentPkgDir = path.join(tmpDir, 'node_modules', 'recurse-parent');
    fs.mkdirSync(parentPkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(parentPkgDir, 'package.json'),
      JSON.stringify({
        name: 'recurse-parent',
        version: '1.0.0',
        npmdata: {
          sets: [
            {
              package: 'recurse-child@1.0.0',
              output: { path: 'child-out' },
            },
          ],
        },
      }),
    );

    // Child package installed too
    const childPkgDir = path.join(tmpDir, 'node_modules', 'recurse-child');
    fs.mkdirSync(childPkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(childPkgDir, 'package.json'),
      JSON.stringify({ name: 'recurse-child', version: '1.0.0' }),
    );
    // Child package has a file that can be checked
    fs.writeFileSync(path.join(childPkgDir, 'child.md'), 'child content');

    // Parent output dir with a matching file + marker
    const parentOutputDir = path.join(tmpDir, 'parent-out');
    fs.mkdirSync(parentOutputDir, { recursive: true });
    fs.writeFileSync(path.join(parentOutputDir, 'parent.md'), 'parent content');
    await writeMarker(markerPath(parentOutputDir), [
      { path: 'parent.md', packageName: 'recurse-parent', packageVersion: '1.0.0' },
    ]);

    // Child output dir (parent output + child path) — child.md is MISSING on disk
    const childOutputDir = path.join(tmpDir, 'parent-out', 'child-out');
    fs.mkdirSync(childOutputDir, { recursive: true });
    await writeMarker(markerPath(childOutputDir), [
      { path: 'child.md', packageName: 'recurse-child', packageVersion: '1.0.0' },
    ]);
    // Deliberately do NOT write child.md → should appear as missing after check

    const entries: NpmdataExtractEntry[] = [
      { package: 'recurse-parent@1.0.0', output: { path: parentOutputDir } },
    ];

    const result = await actionCheck({ entries, cwd: tmpDir });

    // Parent file is present and matching — no drift there
    expect(result.missing).not.toContain('parent.md');
    // Child file is missing — recursive check must detect it
    expect(result.missing).toContain('child.md');
  }, 60000);

  it('verbose mode logs without errors', async () => {
    await installMockPackage('verbose-check-pkg', '1.0.0', { 'readme.md': '# hello' }, tmpDir);
    const outputDir = path.join(tmpDir, 'out-verbose');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'readme.md'), '# hello');

    const markerFile = markerPath(outputDir);
    await writeMarker(markerFile, [
      { path: 'readme.md', packageName: 'verbose-check-pkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'verbose-check-pkg@1.0.0', output: { path: outputDir } },
    ];

    const result = await actionCheck({ entries, cwd: tmpDir, verbose: true });
    expect(result.missing).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  }, 60000);

  it('verbose mode logs when package not installed', async () => {
    const outputDir = path.join(tmpDir, 'out-vnp');
    fs.mkdirSync(outputDir, { recursive: true });

    await writeMarker(markerPath(outputDir), [
      { path: 'file.md', packageName: 'missing-verbose-pkg', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'missing-verbose-pkg@1.0.0', output: { path: outputDir } },
    ];

    const result = await actionCheck({ entries, cwd: tmpDir, verbose: true });
    expect(result.missing).toHaveLength(1);
  }, 30000);

  it('handles error reading transitive package.json gracefully with verbose', async () => {
    // Install a valid package so getInstalledIfSatisfies can parse the version.
    // Then spy on fs.readFileSync to throw on the second read of that package.json
    // (the one done inside the try/catch in actionCheck that looks for npmdata.sets),
    // covering the catch + verbose warn branches.
    await installMockPackage('spy-corrupt-parent', '1.0.0', { 'readme.md': '# hi' }, tmpDir);

    const pkgJsonPath = path.join(tmpDir, 'node_modules', 'spy-corrupt-parent', 'package.json');

    const outputDir = path.join(tmpDir, 'out-spy-corrupt');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'readme.md'), '# hi');

    await writeMarker(markerPath(outputDir), [
      { path: 'readme.md', packageName: 'spy-corrupt-parent', packageVersion: '1.0.0' },
    ]);

    const origReadFileSync = fs.readFileSync;
    let pkgJsonCallCount = 0;
    const spy = jest.spyOn(fs, 'readFileSync').mockImplementation((...args: any[]): any => {
      const filePath = args[0];
      if (typeof filePath === 'string' && filePath === pkgJsonPath) {
        pkgJsonCallCount += 1;
        if (pkgJsonCallCount >= 2) {
          throw new SyntaxError('Simulated corrupt JSON');
        }
      }

      return (origReadFileSync as any)(...args);
    });

    try {
      const entries: NpmdataExtractEntry[] = [
        { package: 'spy-corrupt-parent@1.0.0', output: { path: outputDir } },
      ];
      // Should not throw — catch block inside actionCheck handles the error
      const result = await actionCheck({ entries, cwd: tmpDir, verbose: true });
      expect(result).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  }, 60000);

  it('skips unmanaged entries (output.unmanaged=true)', async () => {
    // Without any package installed or marker, check should return empty for unmanaged
    const entries: NpmdataExtractEntry[] = [
      {
        package: 'unmanaged-check-pkg',
        output: { path: path.join(tmpDir, 'out'), unmanaged: true },
      },
    ];

    const result = await actionCheck({ entries, cwd: tmpDir });
    expect(result.missing).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  }, 10000);

  it('verbose mode logs recursion into transitive packages', async () => {
    // Set up the same hierarchical structure as the recursive check test,
    // but call with verbose: true to exercise the "recursing into" log branch.
    const parentPkgDir = path.join(tmpDir, 'node_modules', 'verbose-recurse-parent');
    fs.mkdirSync(parentPkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(parentPkgDir, 'package.json'),
      JSON.stringify({
        name: 'verbose-recurse-parent',
        version: '1.0.0',
        npmdata: {
          sets: [{ package: 'verbose-recurse-child@1.0.0', output: { path: 'child-out' } }],
        },
      }),
    );

    const childPkgDir = path.join(tmpDir, 'node_modules', 'verbose-recurse-child');
    fs.mkdirSync(childPkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(childPkgDir, 'package.json'),
      JSON.stringify({ name: 'verbose-recurse-child', version: '1.0.0' }),
    );
    fs.writeFileSync(path.join(childPkgDir, 'child.md'), 'child content');

    const parentOutputDir = path.join(tmpDir, 'verbose-parent-out');
    fs.mkdirSync(parentOutputDir, { recursive: true });
    fs.writeFileSync(path.join(parentOutputDir, 'parent.md'), 'parent content');
    await writeMarker(markerPath(parentOutputDir), [
      { path: 'parent.md', packageName: 'verbose-recurse-parent', packageVersion: '1.0.0' },
    ]);

    const childOutputDir = path.join(tmpDir, 'verbose-parent-out', 'child-out');
    fs.mkdirSync(childOutputDir, { recursive: true });
    fs.writeFileSync(path.join(childOutputDir, 'child.md'), 'child content');
    await writeMarker(markerPath(childOutputDir), [
      { path: 'child.md', packageName: 'verbose-recurse-child', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'verbose-recurse-parent@1.0.0', output: { path: parentOutputDir } },
    ];

    const result = await actionCheck({ entries, cwd: tmpDir, verbose: true });
    // Both files are present and match — no drift
    expect(result.missing).not.toContain('parent.md');
    expect(result.missing).not.toContain('child.md');
  }, 60000);

  it('does not report false positives when two packages share the same outputDir', async () => {
    // Regression test for bug: existingMarker was not filtered by packageName before
    // being passed to checkFileset, causing files owned by other packages in the same
    // outputDir to be checked against the current package's source and falsely reported
    // as extra or modified.
    await installMockPackage('shared-pkg-a', '1.0.0', { 'a.md': 'AAA' }, tmpDir);
    await installMockPackage('shared-pkg-b', '1.0.0', { 'b.md': 'BBB' }, tmpDir);

    const sharedOutput = path.join(tmpDir, 'shared-out');
    fs.mkdirSync(sharedOutput, { recursive: true });
    fs.writeFileSync(path.join(sharedOutput, 'a.md'), 'AAA');
    fs.writeFileSync(path.join(sharedOutput, 'b.md'), 'BBB');

    // Both packages share the same output directory and marker file
    await writeMarker(markerPath(sharedOutput), [
      { path: 'a.md', packageName: 'shared-pkg-a', packageVersion: '1.0.0' },
      { path: 'b.md', packageName: 'shared-pkg-b', packageVersion: '1.0.0' },
    ]);

    const entries: NpmdataExtractEntry[] = [
      { package: 'shared-pkg-a@1.0.0', output: { path: sharedOutput } },
      { package: 'shared-pkg-b@1.0.0', output: { path: sharedOutput } },
    ];

    const result = await actionCheck({ entries, cwd: tmpDir });
    // b.md should not appear as extra/modified when checking shared-pkg-a
    // a.md should not appear as extra/modified when checking shared-pkg-b
    expect(result.missing).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
    // extra may include things from respective package sources; we care that
    // cross-package files are not falsely reported.
    expect(result.extra).not.toContain('a.md'); // a.md is in shared-pkg-a's source
    expect(result.extra).not.toContain('b.md'); // b.md is in shared-pkg-b's source
  }, 60000);

  it('reports only missing files owned by the queried package when it is not installed', async () => {
    // Regression: when a package is not installed, all marker entries (including those
    // from sibling packages) were reported as missing. Only entries for the queried
    // package should be surfaced.
    const sharedOutput = path.join(tmpDir, 'shared-out-missing');
    fs.mkdirSync(sharedOutput, { recursive: true });

    await writeMarker(markerPath(sharedOutput), [
      { path: 'a.md', packageName: 'present-pkg', packageVersion: '1.0.0' },
      { path: 'b.md', packageName: 'absent-pkg', packageVersion: '1.0.0' },
    ]);

    // Only absent-pkg is not installed; present-pkg IS installed (mock)
    await installMockPackage('present-pkg', '1.0.0', { 'a.md': 'AAA' }, tmpDir);

    const entries: NpmdataExtractEntry[] = [
      { package: 'absent-pkg@1.0.0', output: { path: sharedOutput } },
    ];

    const result = await actionCheck({ entries, cwd: tmpDir });
    expect(result.missing).toContain('b.md');
    // a.md belongs to present-pkg — must NOT be reported as missing
    expect(result.missing).not.toContain('a.md');
  }, 60000);
});
