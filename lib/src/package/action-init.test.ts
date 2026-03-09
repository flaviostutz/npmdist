import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { actionInit } from './action-init';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npmdata-action-init-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('actionInit', () => {
  it('creates package.json in a new directory', async () => {
    const outputDir = path.join(tmpDir, 'my-data-pkg');
    await actionInit(outputDir, false);

    const pkgJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json')).toString());
    expect(pkgJson.name).toBe('my-data-pkg');
    expect(pkgJson.version).toBe('1.0.0');
    expect(pkgJson.bin).toBe('bin/npmdata.js');
  });

  it('creates bin/npmdata.js shim', async () => {
    const outputDir = path.join(tmpDir, 'my-pkg');
    await actionInit(outputDir, false);

    const binPath = path.join(outputDir, 'bin', 'npmdata.js');
    expect(fs.existsSync(binPath)).toBe(true);
    const content = fs.readFileSync(binPath, 'utf8');
    expect(content).toContain("require('npmdata').binpkg(__dirname, process.argv.slice(2))");
  });

  it('updates existing package.json without throwing', async () => {
    const outputDir = path.join(tmpDir, 'existing-pkg');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'package.json'),
      JSON.stringify({ name: 'existing-pkg', version: '2.0.0', dependencies: { some: '1' } }),
    );

    await actionInit(outputDir, false);

    const pkgJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json')).toString());
    expect(pkgJson.name).toBe('existing-pkg');
    expect(pkgJson.version).toBe('2.0.0');
    expect(pkgJson.bin).toBe('bin/npmdata.js');
    expect(pkgJson.dependencies.some).toBe('1');
  });

  it('skips creating bin/npmdata.js when it already exists', async () => {
    const outputDir = path.join(tmpDir, 'existing-bin');
    fs.mkdirSync(path.join(outputDir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'bin', 'npmdata.js'), '#!/usr/bin/env node\n// existing');

    await actionInit(outputDir, false);

    const content = fs.readFileSync(path.join(outputDir, 'bin', 'npmdata.js'), 'utf8');
    expect(content).toContain('// existing');
  });

  it('logs updated files when verbose=true', async () => {
    const outputDir = path.join(tmpDir, 'verbose-pkg');
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await actionInit(outputDir, true);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('package.json'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('npmdata.js'));
    consoleSpy.mockRestore();
  });

  it('adds --files patterns to package.json files list and npmdata sets', async () => {
    const outputDir = path.join(tmpDir, 'files-pkg');
    await actionInit(outputDir, false, { files: ['docs/**', 'data/**'] });

    const pkgJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json')).toString());
    expect(pkgJson.files).toContain('docs/**');
    expect(pkgJson.files).toContain('data/**');
    expect(pkgJson.files).toContain('package.json');
    expect(pkgJson.files).toContain('bin/npmdata.js');
    expect(pkgJson.npmdata.sets[0].selector.files).toEqual(['docs/**', 'data/**']);
  });

  it('adds --packages as external sets and dependencies', async () => {
    const outputDir = path.join(tmpDir, 'packages-pkg');
    await actionInit(outputDir, false, {
      files: ['conf/globals.js'],
      packages: ['eslint@8'],
    });

    const pkgJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json')).toString());
    expect(pkgJson.dependencies.eslint).toBe('8');
    expect(pkgJson.npmdata.sets).toHaveLength(2);
    expect(pkgJson.npmdata.sets[1].package).toBe('eslint@8');
    expect(pkgJson.npmdata.sets[1].selector.files).toEqual(['conf/globals.js']);
  });

  it('creates self-referencing set as first entry in npmdata sets', async () => {
    const outputDir = path.join(tmpDir, 'self-pkg');
    await actionInit(outputDir, false, {
      files: ['docs/**'],
      packages: ['some-pkg@1'],
    });

    const pkgJson = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json')).toString());
    expect(pkgJson.npmdata.sets[0].package).toBe('self-pkg');
    expect(pkgJson.npmdata.sets[1].package).toBe('some-pkg@1');
  });
});
