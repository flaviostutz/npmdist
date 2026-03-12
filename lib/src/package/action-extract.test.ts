import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installMockPackage } from '../fileset/test-utils';
import { readMarker } from '../fileset/markers';
import { MARKER_FILE } from '../fileset/constants';

import { actionExtract } from './action-extract';

describe('actionExtract', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-action-extract-test-'));
  });

  afterEach(() => {
    // Make all files writable before cleanup
    const makeWritable = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.lstatSync(fullPath);
          if (!stat.isSymbolicLink()) {
            fs.chmodSync(fullPath, 0o755);
            if (stat.isDirectory()) makeWritable(fullPath);
          }
        } catch {
          /* ignore */
        }
      }
    };
    makeWritable(tmpDir);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('extracts files from a single package', async () => {
    await installMockPackage(
      'my-pkg',
      '1.0.0',
      {
        'docs/guide.md': '# Guide',
        'docs/api.md': 'API Docs',
      },
      tmpDir,
    );

    const outputDir = path.join(tmpDir, 'output');
    const result = await actionExtract({
      entries: [{ package: 'my-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
    });

    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'docs/api.md'))).toBe(true);
  }, 60000);

  it('writes .npmdata marker after extraction', async () => {
    await installMockPackage('marker-pkg', '1.0.0', { 'src/index.ts': 'export {}' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    await actionExtract({
      entries: [{ package: 'marker-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
    });

    const marker = await readMarker(path.join(outputDir, MARKER_FILE));
    expect(marker.length).toBeGreaterThan(0);
    expect(marker[0].packageName).toBe('marker-pkg');
  }, 60000);

  it('dry-run reports without writing', async () => {
    await installMockPackage('dry-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    await actionExtract({
      entries: [
        { package: 'dry-pkg', output: { path: outputDir, dryRun: true, gitignore: false } },
      ],

      cwd: tmpDir,
    });

    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, MARKER_FILE))).toBe(false);
  }, 60000);

  it('force overwrites unmanaged files', async () => {
    await installMockPackage('force-pkg', '1.0.0', { 'guide.md': 'pkg content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), 'user content');

    await actionExtract({
      entries: [
        { package: 'force-pkg', output: { path: outputDir, force: true, gitignore: false } },
      ],

      cwd: tmpDir,
    });

    expect(fs.readFileSync(path.join(outputDir, 'guide.md'), 'utf8')).toBe('pkg content');
  }, 60000);

  it('throws on conflict without force', async () => {
    await installMockPackage('conflict-pkg', '1.0.0', { 'guide.md': 'pkg content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), 'user content');

    await expect(
      actionExtract({
        entries: [{ package: 'conflict-pkg', output: { path: outputDir, gitignore: false } }],

        cwd: tmpDir,
      }),
    ).rejects.toThrow('Conflict');
  }, 60000);

  it('keep-existing skips files that already exist', async () => {
    await installMockPackage('keep-pkg', '1.0.0', { 'guide.md': 'pkg content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), 'user content');

    await actionExtract({
      entries: [
        { package: 'keep-pkg', output: { path: outputDir, keepExisting: true, gitignore: false } },
      ],

      cwd: tmpDir,
    });

    expect(fs.readFileSync(path.join(outputDir, 'guide.md'), 'utf8')).toBe('user content');
  }, 60000);

  it('detects circular dependencies', async () => {
    await installMockPackage('circ-pkg', '1.0.0', { 'guide.md': 'content' }, tmpDir);

    const visited = new Set(['circ-pkg']);
    await expect(
      actionExtract({
        entries: [
          { package: 'circ-pkg', output: { path: path.join(tmpDir, 'output'), gitignore: false } },
        ],

        cwd: tmpDir,
        visitedPackages: visited,
      }),
    ).rejects.toThrow('Circular dependency');
  }, 60000);

  it('recursively extracts sub-package npmdata.sets from installed dependency', async () => {
    // Install a "dep" package
    await installMockPackage('recursive-dep', '1.0.0', { 'dep-file.md': '# Dep' }, tmpDir);
    // Install a "main" package that will have npmdata.sets pointing to recursive-dep
    await installMockPackage('recursive-main', '1.0.0', { 'main-file.md': '# Main' }, tmpDir);

    // Modify recursive-main's package.json in node_modules to include npmdata.sets
    const mainPkgPath = path.join(tmpDir, 'node_modules', 'recursive-main');
    const mainPkgJsonPath = path.join(mainPkgPath, 'package.json');
    const existingJson = JSON.parse(fs.readFileSync(mainPkgJsonPath).toString()) as object;
    fs.writeFileSync(
      mainPkgJsonPath,
      JSON.stringify({
        ...existingJson,
        npmdata: {
          sets: [
            {
              package: 'recursive-dep',
              output: { path: 'dep-out', gitignore: false },
            },
          ],
        },
      }),
    );

    const outputDir = path.join(tmpDir, 'output');
    const result = await actionExtract({
      entries: [
        {
          package: 'recursive-main',
          output: { path: outputDir, gitignore: false },
        },
      ],

      cwd: tmpDir,
    });

    // Should have extracted main-file.md AND recursively extracted dep-file.md
    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'main-file.md'))).toBe(true);
    // dep-out path is relative to outputDir (path.join(outputConfig.path, depPath))
    expect(fs.existsSync(path.join(outputDir, 'dep-out', 'dep-file.md'))).toBe(true);
  }, 90000);

  it('entry presets field filters which top-level entries are extracted', async () => {
    await installMockPackage('tl-docs-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);
    await installMockPackage('tl-data-pkg', '1.0.0', { 'data/sample.csv': 'a,b' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output-tl');

    // Extract only the entry tagged with 'docs'
    const result = await actionExtract({
      entries: [
        {
          package: 'tl-docs-pkg',
          presets: ['docs'],
          output: { path: path.join(outputDir, 'docs'), gitignore: false },
        },
        {
          package: 'tl-data-pkg',
          presets: ['data'],
          output: { path: path.join(outputDir, 'data'), gitignore: false },
        },
      ],

      cwd: tmpDir,
    });

    // Without presets filtering at the call site all entries are extracted
    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'docs', 'docs/guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'data', 'data/sample.csv'))).toBe(true);
  }, 90000);

  it('selector.presets filters which nested npmdata.sets are recursively extracted', async () => {
    // Install two nested packages, each representing a different preset
    await installMockPackage('nested-docs', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);
    await installMockPackage('nested-data', '1.0.0', { 'data/sample.csv': 'a,b' }, tmpDir);

    // Install a main package whose npmdata.sets references both nested packages,
    // each tagged with a different preset
    await installMockPackage('preset-main', '1.0.0', { 'main.md': '# Main' }, tmpDir);
    const mainPkgJsonPath = path.join(tmpDir, 'node_modules', 'preset-main', 'package.json');
    const existing = JSON.parse(fs.readFileSync(mainPkgJsonPath).toString()) as object;
    fs.writeFileSync(
      mainPkgJsonPath,
      JSON.stringify({
        ...existing,
        npmdata: {
          sets: [
            {
              package: 'nested-docs',
              presets: ['docs'],
              output: { path: 'nested', gitignore: false },
            },
            {
              package: 'nested-data',
              presets: ['data'],
              output: { path: 'nested', gitignore: false },
            },
          ],
        },
      }),
    );

    const outputDir = path.join(tmpDir, 'output');

    // Extract with selector.presets: ['docs'] — only the docs nested set should be pulled
    await actionExtract({
      entries: [
        {
          package: 'preset-main',
          selector: { presets: ['docs'] },
          output: { path: outputDir, gitignore: false },
        },
      ],

      cwd: tmpDir,
    });

    expect(fs.existsSync(path.join(outputDir, 'main.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'nested', 'docs', 'guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'nested', 'data', 'sample.csv'))).toBe(false);
  }, 90000);

  it('throws when selector.presets does not match any set in the producer package', async () => {
    await installMockPackage('no-match-pkg', '1.0.0', { 'main.md': '# Main' }, tmpDir);
    const mainPkgJsonPath = path.join(tmpDir, 'node_modules', 'no-match-pkg', 'package.json');
    const existing = JSON.parse(fs.readFileSync(mainPkgJsonPath).toString()) as object;
    fs.writeFileSync(
      mainPkgJsonPath,
      JSON.stringify({
        ...existing,
        npmdata: {
          sets: [{ package: 'some-dep', presets: ['docs'], output: { path: '.' } }],
        },
      }),
    );

    const outputDir = path.join(tmpDir, 'output');
    await expect(
      actionExtract({
        entries: [
          {
            package: 'no-match-pkg',
            selector: { presets: ['nonexistent'] },
            output: { path: outputDir, gitignore: false },
          },
        ],

        cwd: tmpDir,
      }),
    ).rejects.toThrow('nonexistent');
  }, 60000);

  it('emits file-modified event on re-extraction with changed content', async () => {
    // First extraction
    await installMockPackage('modify-pkg', '1.0.0', { 'doc.md': '# v1' }, tmpDir);
    const outputDir = path.join(tmpDir, 'output');
    await actionExtract({
      entries: [{ package: 'modify-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
    });

    // Update the file in node_modules to simulate a new version with changed content
    const pkgFile = path.join(tmpDir, 'node_modules', 'modify-pkg', 'doc.md');
    fs.chmodSync(pkgFile, 0o644);
    fs.writeFileSync(pkgFile, '# v2 changed content');

    const events: string[] = [];
    await actionExtract({
      entries: [
        {
          package: 'modify-pkg',
          output: { path: outputDir, force: true, gitignore: false },
        },
      ],

      cwd: tmpDir,
      onProgress: (e) => events.push(e.type),
    });

    expect(events).toContain('file-modified');
    expect(fs.readFileSync(path.join(outputDir, 'doc.md'), 'utf8')).toBe('# v2 changed content');
  }, 90000);

  it('creates symlinks when symlinks config is provided', async () => {
    await installMockPackage('symlink-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);
    const outputDir = path.join(tmpDir, 'output');
    const linkTarget = path.join(tmpDir, 'links');
    fs.mkdirSync(linkTarget, { recursive: true });

    await actionExtract({
      entries: [
        {
          package: 'symlink-pkg',
          output: {
            path: outputDir,
            gitignore: false,
            symlinks: [{ source: 'docs/guide.md', target: path.relative(outputDir, linkTarget) }],
          },
        },
      ],

      cwd: tmpDir,
    });

    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
    // symlink should be created in linkTarget
    const linkPath = path.join(linkTarget, 'guide.md');
    expect(fs.existsSync(linkPath) || fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
  }, 90000);

  it('throws when entry is missing package field', async () => {
    await expect(
      actionExtract({
        entries: [{ package: '', output: { path: 'out' } }],

        cwd: tmpDir,
      }),
    ).rejects.toThrow('"package" field');
  });

  it('defaults output.path to cwd when omitted', async () => {
    await installMockPackage('default-out-pkg', '1.0.0', { 'file.md': '# hi' }, tmpDir);
    const result = await actionExtract({
      entries: [{ package: 'default-out-pkg' }],

      cwd: tmpDir,
    });
    expect(result.added).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, 'file.md'))).toBe(true);
  }, 60_000);

  it('returns zero counts for empty entries', async () => {
    const result = await actionExtract({
      entries: [],

      cwd: tmpDir,
    });

    expect(result.added).toBe(0);
    expect(result.modified).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.skipped).toBe(0);
  }, 30000);

  it('unmanaged flag skips conflicting unmanaged files instead of throwing', async () => {
    await installMockPackage('unmanaged-pkg', '1.0.0', { 'guide.md': 'pkg content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'guide.md'), 'user content');

    // Should not throw even though guide.md is an unmanaged conflict
    await expect(
      actionExtract({
        entries: [
          {
            package: 'unmanaged-pkg',
            output: { path: outputDir, unmanaged: true, gitignore: false },
          },
        ],

        cwd: tmpDir,
      }),
    ).resolves.toBeDefined();

    // Unmanaged file should remain untouched
    expect(fs.readFileSync(path.join(outputDir, 'guide.md'), 'utf8')).toBe('user content');
  }, 60000);

  it('emits package-start and package-end progress events', async () => {
    await installMockPackage('events-pkg', '1.0.0', { 'readme.md': '# Readme' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    const events: string[] = [];

    await actionExtract({
      entries: [{ package: 'events-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
      onProgress: (e) => events.push(e.type),
    });

    expect(events).toContain('package-start');
    expect(events).toContain('package-end');
    expect(events).toContain('file-added');
  }, 60000);

  it('emits file-skipped event when file is unchanged on re-extraction', async () => {
    await installMockPackage('skip-pkg', '1.0.0', { 'doc.md': '# Doc' }, tmpDir);
    const outputDir = path.join(tmpDir, 'output');

    // First extraction
    await actionExtract({
      entries: [{ package: 'skip-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
    });

    const events: string[] = [];
    // Second extraction without changes — file should be skipped
    await actionExtract({
      entries: [{ package: 'skip-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
      onProgress: (e) => events.push(e.type),
    });

    expect(events).toContain('file-skipped');
  }, 90000);

  it('extracts multiple entries in a single call', async () => {
    await installMockPackage('multi-a', '1.0.0', { 'a.md': '# A' }, tmpDir);
    await installMockPackage('multi-b', '1.0.0', { 'b.md': '# B' }, tmpDir);

    const outputA = path.join(tmpDir, 'out-a');
    const outputB = path.join(tmpDir, 'out-b');

    const result = await actionExtract({
      entries: [
        { package: 'multi-a', output: { path: outputA, gitignore: false } },
        { package: 'multi-b', output: { path: outputB, gitignore: false } },
      ],

      cwd: tmpDir,
    });

    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputA, 'a.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputB, 'b.md'))).toBe(true);
  }, 90000);

  it('does not create symlinks when dryRun is true', async () => {
    await installMockPackage('dryrun-sym-pkg', '1.0.0', { 'docs/guide.md': '# Guide' }, tmpDir);
    const outputDir = path.join(tmpDir, 'output');
    const linkTarget = path.join(tmpDir, 'links');
    fs.mkdirSync(linkTarget, { recursive: true });

    await actionExtract({
      entries: [
        {
          package: 'dryrun-sym-pkg',
          output: {
            path: outputDir,
            gitignore: false,
            dryRun: true,
            symlinks: [{ source: 'docs/guide.md', target: path.relative(outputDir, linkTarget) }],
          },
        },
      ],

      cwd: tmpDir,
    });

    // No file should be written in dryRun mode
    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(false);
    // No symlink should be created in dryRun mode
    expect(fs.readdirSync(linkTarget)).toHaveLength(0);
  }, 60000);

  it('deletes files removed from package on re-extraction and emits file-deleted event', async () => {
    // First extraction: package has two files
    await installMockPackage(
      'delete-pkg',
      '1.0.0',
      { 'keep.md': '# Keep', 'remove.md': '# Remove' },
      tmpDir,
    );
    const outputDir = path.join(tmpDir, 'output');
    await actionExtract({
      entries: [{ package: 'delete-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
    });

    expect(fs.existsSync(path.join(outputDir, 'remove.md'))).toBe(true);

    // Update the installed package to remove remove.md
    const pkgDir = path.join(tmpDir, 'node_modules', 'delete-pkg');
    fs.rmSync(path.join(pkgDir, 'remove.md'));

    const events: string[] = [];
    const result = await actionExtract({
      entries: [{ package: 'delete-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
      onProgress: (e) => events.push(e.type),
    });

    expect(result.deleted).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'remove.md'))).toBe(false);
    expect(events).toContain('file-deleted');
  }, 90000);

  it('uses explicit selector and contentReplacements when provided', async () => {
    await installMockPackage(
      'selector-pkg',
      '1.0.0',
      { 'docs/guide.md': 'Hello REPLACE_ME world', 'src/index.ts': 'export {}' },
      tmpDir,
    );

    const outputDir = path.join(tmpDir, 'output');
    const result = await actionExtract({
      entries: [
        {
          package: 'selector-pkg',
          selector: { files: ['docs/**'] },
          output: {
            path: outputDir,
            gitignore: false,
            contentReplacements: [{ files: 'docs/**', match: 'REPLACE_ME', replace: 'REPLACED' }],
          },
        },
      ],

      cwd: tmpDir,
    });

    // Only docs files selected by selector
    expect(result.added).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'src/index.ts'))).toBe(false);
    // Content replacement should have replaced REPLACE_ME with REPLACED
    expect(fs.readFileSync(path.join(outputDir, 'docs/guide.md'), 'utf8')).toContain('REPLACED');
    expect(fs.readFileSync(path.join(outputDir, 'docs/guide.md'), 'utf8')).not.toContain(
      'REPLACE_ME',
    );
  }, 60000);

  it('recursively merges selector and output configs across dependency levels', async () => {
    // A dependency package with files in docs/ (selector target) and src/ (excluded)
    await installMockPackage(
      'merge-dep',
      '1.0.0',
      {
        'docs/guide.md': 'PARENT_TOKEN DEP_TOKEN content',
        'src/index.ts': 'should be excluded by dep selector',
      },
      tmpDir,
    );

    // A main package that lists merge-dep in its npmdata.sets
    await installMockPackage('merge-main', '1.0.0', { 'readme.md': 'main file' }, tmpDir);

    // Patch main package.json in node_modules to declare npmdata.sets for merge-dep
    const mainPkgJsonPath = path.join(tmpDir, 'node_modules', 'merge-main', 'package.json');
    const mainPkgJson = JSON.parse(fs.readFileSync(mainPkgJsonPath).toString()) as object;
    fs.writeFileSync(
      mainPkgJsonPath,
      JSON.stringify({
        ...mainPkgJson,
        npmdata: {
          sets: [
            {
              package: 'merge-dep',
              // dep-level selector: restrict to docs/** only
              selector: { files: ['docs/**'] },
              output: {
                path: 'dep-out',
                gitignore: false,
                // dep-level replacement: DEP_TOKEN → dep-replaced
                contentReplacements: [{ files: '**', match: 'DEP_TOKEN', replace: 'dep-replaced' }],
              },
            },
          ],
        },
      }),
    );

    const outputDir = path.join(tmpDir, 'output');

    // Pre-create an unmanaged file in the dep's computed output location.
    // Without force cascading this would throw a conflict error.
    fs.mkdirSync(path.join(outputDir, 'dep-out', 'docs'), { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'dep-out', 'docs', 'guide.md'),
      'unmanaged pre-existing content',
    );

    await actionExtract({
      entries: [
        {
          package: 'merge-main',
          output: {
            path: outputDir,
            gitignore: false,
            // force: true must cascade to sub-packages (parent takes precedence)
            force: true,
            // parent-level replacement: PARENT_TOKEN → parent-replaced
            contentReplacements: [
              { files: '**', match: 'PARENT_TOKEN', replace: 'parent-replaced' },
            ],
          },
        },
      ],

      cwd: tmpDir,
    });

    // Main package file extracted to outputDir
    expect(fs.existsSync(path.join(outputDir, 'readme.md'))).toBe(true);

    // Dep file: path composed as outputDir/dep-out/docs/guide.md
    const depFile = path.join(outputDir, 'dep-out', 'docs', 'guide.md');
    expect(fs.existsSync(depFile)).toBe(true);

    // Dep selector must have excluded src/index.ts
    expect(fs.existsSync(path.join(outputDir, 'dep-out', 'src', 'index.ts'))).toBe(false);

    // Both contentReplacements must have been applied (parent's + dep's merged)
    const content = fs.readFileSync(depFile, 'utf8');
    expect(content).toContain('parent-replaced');
    expect(content).toContain('dep-replaced');
    expect(content).not.toContain('PARENT_TOKEN');
    expect(content).not.toContain('DEP_TOKEN');
  }, 90000);

  it('rolls back newly created files when an error occurs mid-extraction', async () => {
    await installMockPackage('rollback-pkg', '1.0.0', { 'file.md': 'content' }, tmpDir);
    await installMockPackage('bad-pkg', '1.0.0', { 'conflict.md': 'pkg content' }, tmpDir);

    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    // Pre-create an unmanaged conflict for the second entry to trigger error after first succeeds
    fs.writeFileSync(path.join(outputDir, 'conflict.md'), 'user content');

    await expect(
      actionExtract({
        entries: [
          { package: 'rollback-pkg', output: { path: outputDir, gitignore: false } },
          { package: 'bad-pkg', output: { path: outputDir, gitignore: false } },
        ],

        cwd: tmpDir,
      }),
    ).rejects.toThrow('Conflict');

    // Files written by the first entry should have been rolled back
    expect(fs.existsSync(path.join(outputDir, 'file.md'))).toBe(false);
  }, 90000);

  it('parent dryRun cascades and prevents dep sub-package from writing files', async () => {
    await installMockPackage('dryrun-dep', '1.0.0', { 'dep.md': '# Dep' }, tmpDir);
    await installMockPackage('dryrun-main', '1.0.0', { 'main.md': '# Main' }, tmpDir);

    const mainPkgJsonPath = path.join(tmpDir, 'node_modules', 'dryrun-main', 'package.json');
    const mainPkgJson = JSON.parse(fs.readFileSync(mainPkgJsonPath).toString()) as object;
    fs.writeFileSync(
      mainPkgJsonPath,
      JSON.stringify({
        ...mainPkgJson,
        npmdata: {
          sets: [
            {
              package: 'dryrun-dep',
              output: { path: 'dep-out', gitignore: false },
            },
          ],
        },
      }),
    );

    const outputDir = path.join(tmpDir, 'output');
    // parent dryRun: true — no files written for main OR dep
    await actionExtract({
      entries: [
        {
          package: 'dryrun-main',
          output: { path: outputDir, gitignore: false, dryRun: true },
        },
      ],

      cwd: tmpDir,
    });

    expect(fs.existsSync(path.join(outputDir, 'main.md'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'dep-out', 'dep.md'))).toBe(false);
  }, 90000);

  it('parent keepExisting cascades and preserves existing files in dep output', async () => {
    await installMockPackage('keepex-dep', '1.0.0', { 'dep.md': 'new content from pkg' }, tmpDir);
    await installMockPackage('keepex-main', '1.0.0', { 'main.md': '# Main' }, tmpDir);

    const mainPkgJsonPath = path.join(tmpDir, 'node_modules', 'keepex-main', 'package.json');
    const mainPkgJson = JSON.parse(fs.readFileSync(mainPkgJsonPath).toString()) as object;
    fs.writeFileSync(
      mainPkgJsonPath,
      JSON.stringify({
        ...mainPkgJson,
        npmdata: {
          sets: [
            {
              package: 'keepex-dep',
              output: { path: 'dep-out', gitignore: false },
            },
          ],
        },
      }),
    );

    const outputDir = path.join(tmpDir, 'output');
    // Pre-create a file in the dep output location — with keepExisting it should NOT be overwritten
    fs.mkdirSync(path.join(outputDir, 'dep-out'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'dep-out', 'dep.md'), 'existing user content');

    // parent keepExisting: true cascades to dep
    await actionExtract({
      entries: [
        {
          package: 'keepex-main',
          output: { path: outputDir, gitignore: false, keepExisting: true },
        },
      ],

      cwd: tmpDir,
    });

    // dep.md should remain unchanged (kept, not overwritten)
    expect(fs.readFileSync(path.join(outputDir, 'dep-out', 'dep.md'), 'utf8')).toBe(
      'existing user content',
    );
  }, 90000);

  it('dep-level force is used when parent does not set force', async () => {
    await installMockPackage('depforce-pkg', '1.0.0', { 'dep.md': 'pkg content' }, tmpDir);
    await installMockPackage('depforce-main', '1.0.0', { 'main.md': '# Main' }, tmpDir);

    const mainPkgJsonPath = path.join(tmpDir, 'node_modules', 'depforce-main', 'package.json');
    const mainPkgJson = JSON.parse(fs.readFileSync(mainPkgJsonPath).toString()) as object;
    fs.writeFileSync(
      mainPkgJsonPath,
      JSON.stringify({
        ...mainPkgJson,
        npmdata: {
          sets: [
            {
              package: 'depforce-pkg',
              // dep declares its own force: true; parent does not set force at all
              output: { path: 'dep-out', gitignore: false, force: true },
            },
          ],
        },
      }),
    );

    const outputDir = path.join(tmpDir, 'output');
    // Pre-create an unmanaged file — dep's own force: true should allow overwriting
    fs.mkdirSync(path.join(outputDir, 'dep-out'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'dep-out', 'dep.md'), 'unmanaged old content');

    // Parent has no force set; dep's force: true is preserved via `undefined ?? true`
    await actionExtract({
      entries: [
        {
          package: 'depforce-main',
          output: { path: outputDir, gitignore: false },
        },
      ],

      cwd: tmpDir,
    });

    expect(fs.readFileSync(path.join(outputDir, 'dep-out', 'dep.md'), 'utf8')).toBe('pkg content');
  }, 90000);

  it('parent unmanaged: true cascades to dep and dep files are writable', async () => {
    await installMockPackage('unmngcasc-dep', '1.0.0', { 'dep.md': 'dep content' }, tmpDir);
    await installMockPackage('unmngcasc-main', '1.0.0', { 'main.md': '# Main' }, tmpDir);

    const mainPkgJsonPath = path.join(tmpDir, 'node_modules', 'unmngcasc-main', 'package.json');
    const mainPkgJson = JSON.parse(fs.readFileSync(mainPkgJsonPath).toString()) as object;
    fs.writeFileSync(
      mainPkgJsonPath,
      JSON.stringify({
        ...mainPkgJson,
        npmdata: {
          sets: [{ package: 'unmngcasc-dep', output: { path: 'dep-out', gitignore: false } }],
        },
      }),
    );

    const outputDir = path.join(tmpDir, 'output');
    await actionExtract({
      entries: [
        {
          package: 'unmngcasc-main',
          output: { path: outputDir, gitignore: false, unmanaged: true },
        },
      ],

      cwd: tmpDir,
    });

    const depFile = path.join(outputDir, 'dep-out', 'dep.md');
    expect(fs.existsSync(depFile)).toBe(true);
    // parent unmanaged: true must cascade: dep files should not be made read-only
    const { mode } = fs.statSync(depFile);
    expect(mode & 0o200).toBeGreaterThan(0); // owner write bit must be set
  }, 90000);

  it('dep-level unmanaged: true preserved when parent does not set unmanaged', async () => {
    await installMockPackage('unmngdep-pkg', '1.0.0', { 'dep.md': 'dep content' }, tmpDir);
    await installMockPackage('unmngdep-main', '1.0.0', { 'main.md': '# Main' }, tmpDir);

    const mainPkgJsonPath = path.join(tmpDir, 'node_modules', 'unmngdep-main', 'package.json');
    const mainPkgJson = JSON.parse(fs.readFileSync(mainPkgJsonPath).toString()) as object;
    fs.writeFileSync(
      mainPkgJsonPath,
      JSON.stringify({
        ...mainPkgJson,
        npmdata: {
          sets: [
            {
              package: 'unmngdep-pkg',
              // dep declares its own unmanaged: true; parent does not set unmanaged at all
              output: { path: 'dep-out', gitignore: false, unmanaged: true },
            },
          ],
        },
      }),
    );

    const outputDir = path.join(tmpDir, 'output');
    // parent leaves unmanaged undefined — dep's own value must survive via `undefined ?? true`
    await actionExtract({
      entries: [{ package: 'unmngdep-main', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
    });

    const depFile = path.join(outputDir, 'dep-out', 'dep.md');
    expect(fs.existsSync(depFile)).toBe(true);
    const { mode } = fs.statSync(depFile);
    expect(mode & 0o200).toBeGreaterThan(0); // dep's unmanaged: true must be preserved
  }, 90000);

  it('parent gitignore: false cascades to dep and suppresses .gitignore in dep output', async () => {
    await installMockPackage('gitcasc-dep', '1.0.0', { 'dep.md': 'dep content' }, tmpDir);
    await installMockPackage('gitcasc-main', '1.0.0', { 'main.md': '# Main' }, tmpDir);

    const mainPkgJsonPath = path.join(tmpDir, 'node_modules', 'gitcasc-main', 'package.json');
    const mainPkgJson = JSON.parse(fs.readFileSync(mainPkgJsonPath).toString()) as object;
    fs.writeFileSync(
      mainPkgJsonPath,
      JSON.stringify({
        ...mainPkgJson,
        npmdata: {
          sets: [
            {
              package: 'gitcasc-dep',
              // dep does NOT set gitignore (defaults to creating .gitignore)
              output: { path: 'dep-out' },
            },
          ],
        },
      }),
    );

    const outputDir = path.join(tmpDir, 'output');
    await actionExtract({
      entries: [
        // parent explicitly disables gitignore — must cascade to dep
        { package: 'gitcasc-main', output: { path: outputDir, gitignore: false } },
      ],

      cwd: tmpDir,
    });

    // dep output should NOT contain a .gitignore (parent gitignore: false cascaded)
    expect(fs.existsSync(path.join(outputDir, 'dep-out', '.gitignore'))).toBe(false);
  }, 90000);

  it('symlinks from both parent and dep levels are all created', async () => {
    await installMockPackage('symsub-dep', '1.0.0', { 'dep-docs/dep.md': '# Dep Doc' }, tmpDir);
    await installMockPackage('symsub-main', '1.0.0', { 'main-docs/main.md': '# Main Doc' }, tmpDir);

    const depOutRelative = 'dep-out';
    const mainPkgJsonPath = path.join(tmpDir, 'node_modules', 'symsub-main', 'package.json');
    const mainPkgJson = JSON.parse(fs.readFileSync(mainPkgJsonPath).toString()) as object;
    fs.writeFileSync(
      mainPkgJsonPath,
      JSON.stringify({
        ...mainPkgJson,
        npmdata: {
          sets: [
            {
              package: 'symsub-dep',
              output: {
                path: depOutRelative,
                gitignore: false,
                // dep declares its own symlink
                symlinks: [{ source: 'dep-docs/dep.md', target: '../dep-links' }],
              },
            },
          ],
        },
      }),
    );

    const outputDir = path.join(tmpDir, 'output');
    const mainLinksDir = path.join(tmpDir, 'main-links');
    fs.mkdirSync(mainLinksDir, { recursive: true });

    await actionExtract({
      entries: [
        {
          package: 'symsub-main',
          output: {
            path: outputDir,
            gitignore: false,
            // parent declares its own symlink for main-docs/main.md
            symlinks: [
              { source: 'main-docs/main.md', target: path.relative(outputDir, mainLinksDir) },
            ],
          },
        },
      ],

      cwd: tmpDir,
    });

    // main package file and its symlink
    expect(fs.existsSync(path.join(outputDir, 'main-docs/main.md'))).toBe(true);
    const mainLinkPath = path.join(mainLinksDir, 'main.md');
    expect(fs.existsSync(mainLinkPath) || fs.lstatSync(mainLinkPath).isSymbolicLink()).toBe(true);

    // dep file
    const depDocPath = path.join(outputDir, depOutRelative, 'dep-docs/dep.md');
    expect(fs.existsSync(depDocPath)).toBe(true);
    // dep symlink: target '../dep-links' is relative to dep-out outputDir (outputDir/dep-out)
    const depLinkPath = path.join(outputDir, 'dep-links', 'dep.md');
    expect(fs.existsSync(depLinkPath) || fs.lstatSync(depLinkPath).isSymbolicLink()).toBe(true);
  }, 90000);

  it('three-level deep recursion composes paths correctly at each hop', async () => {
    await installMockPackage('level3-pkg', '1.0.0', { 'deep.md': '# Deep' }, tmpDir);
    await installMockPackage('level2-pkg', '1.0.0', { 'mid.md': '# Mid' }, tmpDir);
    await installMockPackage('level1-pkg', '1.0.0', { 'top.md': '# Top' }, tmpDir);

    // level2 depends on level3
    const l2PkgJsonPath = path.join(tmpDir, 'node_modules', 'level2-pkg', 'package.json');
    const l2PkgJson = JSON.parse(fs.readFileSync(l2PkgJsonPath).toString()) as object;
    fs.writeFileSync(
      l2PkgJsonPath,
      JSON.stringify({
        ...l2PkgJson,
        npmdata: {
          sets: [{ package: 'level3-pkg', output: { path: 'l3', gitignore: false } }],
        },
      }),
    );

    // level1 depends on level2
    const l1PkgJsonPath = path.join(tmpDir, 'node_modules', 'level1-pkg', 'package.json');
    const l1PkgJson = JSON.parse(fs.readFileSync(l1PkgJsonPath).toString()) as object;
    fs.writeFileSync(
      l1PkgJsonPath,
      JSON.stringify({
        ...l1PkgJson,
        npmdata: {
          sets: [{ package: 'level2-pkg', output: { path: 'l2', gitignore: false } }],
        },
      }),
    );

    const outputDir = path.join(tmpDir, 'output');
    await actionExtract({
      entries: [{ package: 'level1-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
    });

    // level1 files at outputDir/
    expect(fs.existsSync(path.join(outputDir, 'top.md'))).toBe(true);
    // level2 files at outputDir/l2/
    expect(fs.existsSync(path.join(outputDir, 'l2', 'mid.md'))).toBe(true);
    // level3 files at outputDir/l2/l3/
    expect(fs.existsSync(path.join(outputDir, 'l2', 'l3', 'deep.md'))).toBe(true);
  }, 90000);

  it('does not extract LICENSE file by default', async () => {
    await installMockPackage(
      'license-pkg',
      '1.0.0',
      {
        'docs/guide.md': '# Guide',
        LICENSE: 'MIT License',
      },
      tmpDir,
    );

    const outputDir = path.join(tmpDir, 'output');
    await actionExtract({
      entries: [{ package: 'license-pkg', output: { path: outputDir, gitignore: false } }],

      cwd: tmpDir,
    });

    expect(fs.existsSync(path.join(outputDir, 'docs/guide.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'LICENSE'))).toBe(false);
  }, 60000);
});
