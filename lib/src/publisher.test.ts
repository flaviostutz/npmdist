import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { initPublisher } from './publisher';

describe('Publisher', () => {
  // eslint-disable-next-line functional/no-let
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  describe('initPublisher', () => {
    it('should return error when no folders specified', async () => {
      const result = await initPublisher([]);
      expect(result.success).toBe(false);
      expect(result.message).toContain('no folders specified');
    });

    it('should return error when folder does not exist', async () => {
      const result = await initPublisher(['nonexistent-folder'], { workingDir: tmpDir });
      expect(result.success).toBe(false);
      expect(result.message).toContain('folder validation failed');
      expect(result.message).toContain('nonexistent-folder');
    });

    it('should return error when path is a file, not a directory', async () => {
      const filePath = path.join(tmpDir, 'somefile.txt');
      fs.writeFileSync(filePath, 'content');
      const result = await initPublisher(['somefile.txt'], { workingDir: tmpDir });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Not a directory');
    });

    it('should return error when one of several folders does not exist', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));
      const result = await initPublisher(['docs', 'missing-folder'], { workingDir: tmpDir });
      expect(result.success).toBe(false);
      expect(result.message).toContain('missing-folder');
    });

    it('should successfully initialize with a valid folder', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      const result = await initPublisher(['docs'], { workingDir: tmpDir });

      expect(result.success).toBe(true);
      expect(result.message).toContain('completed successfully');
      expect(result.publishedFolders).toContain('docs');
      expect(result.packageJsonPath).toBe(path.join(tmpDir, 'package.json'));
    });

    it('should create package.json with correct content', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      await initPublisher(['docs'], { workingDir: tmpDir });

      const pkgJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json')).toString());
      expect(pkgJson.files).toContain('docs/**');
      expect(pkgJson.files).toContain('package.json');
      expect(pkgJson.files).toContain('bin/npmdata.js');
      expect(pkgJson.dependencies.npmdata).toMatch(/^\^\d+\.\d+\.\d+$/);
      expect(pkgJson.bin).toBe('bin/npmdata.js');
      expect(pkgJson.name).toBe(path.basename(tmpDir));
      expect(pkgJson.version).toBe('1.0.0');
    });

    it('should create cli extract script', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      await initPublisher(['docs'], { workingDir: tmpDir });

      const cliScriptPath = path.join(tmpDir, 'bin', 'npmdata.js');
      expect(fs.existsSync(cliScriptPath)).toBe(true);
      const content = fs.readFileSync(cliScriptPath, 'utf8');
      expect(content).toContain('npmdata');
      expect(content).toContain('#!/usr/bin/env node');
    });

    it('should make cli script executable', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      await initPublisher(['docs'], { workingDir: tmpDir });

      const cliScriptPath = path.join(tmpDir, 'bin', 'npmdata.js');
      const stats = fs.statSync(cliScriptPath);
      // eslint-disable-next-line no-bitwise
      expect(stats.mode & 0o111).toBeGreaterThan(0);
    });

    it('should update existing package.json preserving existing fields', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      const existingPkg = {
        name: 'my-existing-package',
        version: '2.5.0',
        description: 'My existing package',
        files: ['existing/**'],
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(existingPkg));

      await initPublisher(['docs'], { workingDir: tmpDir });

      const pkgJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json')).toString());
      expect(pkgJson.name).toBe('my-existing-package');
      expect(pkgJson.version).toBe('2.5.0');
      expect(pkgJson.description).toBe('My existing package');
      expect(pkgJson.files).toContain('docs/**');
      expect(pkgJson.files).toContain('existing/**');
    });

    it('should initialize with multiple folders', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));
      fs.mkdirSync(path.join(tmpDir, 'src'));

      const result = await initPublisher(['docs', 'src'], { workingDir: tmpDir });

      expect(result.success).toBe(true);
      expect(result.publishedFolders).toEqual(['docs', 'src']);

      const pkgJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json')).toString());
      expect(pkgJson.files).toContain('docs/**');
      expect(pkgJson.files).toContain('src/**');
    });

    it('should not duplicate folder patterns on re-init', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      await initPublisher(['docs'], { workingDir: tmpDir });
      await initPublisher(['docs'], { workingDir: tmpDir });

      const pkgJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json')).toString());
      const docsPatterns = pkgJson.files.filter((f: string) => f === 'docs/**');
      expect(docsPatterns).toHaveLength(1);
    });

    it('should use process.cwd() as workingDir when not specified', async () => {
      // initPublisher without workingDir option - just ensure it doesn't crash
      // (it will use process.cwd() which is the lib dir - which has no docs folder)
      const result = await initPublisher(['nonexistent-folder-xyz']);
      expect(result.success).toBe(false);
    });

    it('should preserve existing non-folder file patterns', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      const existingPkg = {
        name: 'my-package',
        version: '1.0.0',
        files: ['docs/**', 'LICENSE', 'CHANGELOG.md'],
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(existingPkg));

      await initPublisher(['docs'], { workingDir: tmpDir });

      const pkgJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json')).toString());
      expect(pkgJson.files).toContain('LICENSE');
      expect(pkgJson.files).toContain('CHANGELOG.md');
    });

    it('should add npmdata dependency when no dependencies exist', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      const existingPkg = { name: 'my-package', version: '1.0.0' };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(existingPkg));

      await initPublisher(['docs'], { workingDir: tmpDir });

      const pkgJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json')).toString());
      // Should be pinned to actual version (^x.y.z) rather than 'latest'
      expect(pkgJson.dependencies.npmdata).toMatch(/^\^?\d+\.\d+\.\d+|^latest$/);
      // Should NOT be the literal string 'latest'
      expect(pkgJson.dependencies.npmdata).not.toBe('latest');
    });

    it('should preserve existing bin field if set', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      const existingPkg = {
        name: 'my-package',
        version: '1.0.0',
        bin: 'bin/my-custom-entry.js',
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(existingPkg));

      await initPublisher(['docs'], { workingDir: tmpDir });

      const pkgJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json')).toString());
      expect(pkgJson.bin).toBe('bin/my-custom-entry.js');
    });

    it('should set name from dir basename if missing in existing package.json', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      const existingPkg = { version: '1.0.0' };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(existingPkg));

      await initPublisher(['docs'], { workingDir: tmpDir });

      const pkgJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json')).toString());
      expect(pkgJson.name).toBe(path.basename(tmpDir));
    });

    it('should store additional packages in package.json npmdata field', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      const result = await initPublisher(['docs'], {
        workingDir: tmpDir,
        additionalPackages: ['shared-data@^1.0.0', 'other-pkg'],
      });

      expect(result.success).toBe(true);
      expect(result.additionalPackages).toEqual(['shared-data@^1.0.0', 'other-pkg']);

      const pkgJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json')).toString());
      const entries = pkgJson.npmdata as Array<{ package: string }>;
      expect(entries.some((e) => e.package === 'shared-data@^1.0.0')).toBe(true);
      expect(entries.some((e) => e.package === 'other-pkg')).toBe(true);
    });

    it('should add additional packages to dependencies', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      await initPublisher(['docs'], {
        workingDir: tmpDir,
        additionalPackages: ['shared-data@^1.0.0', 'other-pkg'],
      });

      const pkgJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json')).toString());
      expect(pkgJson.dependencies['shared-data']).toBe('^1.0.0');
      expect(pkgJson.dependencies['other-pkg']).toBe('latest');
    });

    it('should not duplicate additional packages on re-init', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      await initPublisher(['docs'], {
        workingDir: tmpDir,
        additionalPackages: ['shared-data@^1.0.0'],
      });
      await initPublisher(['docs'], {
        workingDir: tmpDir,
        additionalPackages: ['shared-data@^1.0.0'],
      });

      const pkgJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json')).toString());
      const entries = pkgJson.npmdata as Array<{ package: string }>;
      const matches = entries.filter((e) => e.package === 'shared-data@^1.0.0');
      expect(matches).toHaveLength(1);
    });

    it('should merge additional packages on re-init', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      await initPublisher(['docs'], {
        workingDir: tmpDir,
        additionalPackages: ['pkg-a'],
      });
      await initPublisher(['docs'], {
        workingDir: tmpDir,
        additionalPackages: ['pkg-b'],
      });

      const pkgJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json')).toString());
      const entries = pkgJson.npmdata as Array<{ package: string }>;
      expect(entries.some((e) => e.package === 'pkg-a')).toBe(true);
      expect(entries.some((e) => e.package === 'pkg-b')).toBe(true);
    });

    it('should handle scoped package names in additionalPackages', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      await initPublisher(['docs'], {
        workingDir: tmpDir,
        additionalPackages: ['@my-org/shared-data@^2.0.0'],
      });

      const pkgJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json')).toString());
      const entries = pkgJson.npmdata as Array<{ package: string }>;
      expect(entries.some((e) => e.package === '@my-org/shared-data@^2.0.0')).toBe(true);
      expect(pkgJson.dependencies['@my-org/shared-data']).toBe('^2.0.0');
    });

    it('should return empty additionalPackages when none specified', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));

      const result = await initPublisher(['docs'], { workingDir: tmpDir });

      expect(result.success).toBe(true);
      expect(result.additionalPackages).toBeUndefined();

      const pkgJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json')).toString());
      const entries = pkgJson.npmdata as Array<{ package: string; outputDir: string }>;
      expect(Array.isArray(entries)).toBe(true);
      expect(entries).toHaveLength(1);
      expect(entries[0].package).toBe(pkgJson.name);
      expect(entries[0].outputDir).toBe('.');
    });
  });
});
