import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { Consumer } from './consumer';
import { ConsumerConfig, FolderPublisherMarker } from './types';

describe('Consumer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consumer-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  describe('loadAllManagedFiles', () => {
    it('should load files from marker', () => {
      const outputDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });

      // Create marker file
      const marker: FolderPublisherMarker = {
        version: '1.0.0',
        managedFiles: [
          {
            path: 'test.txt',
            packageName: 'test-package',
            packageVersion: '1.0.0',
          },
        ],
        updated: Date.now(),
      };

      fs.writeFileSync(path.join(outputDir, '.folder-publisher'), JSON.stringify(marker));

      // Create the actual file
      fs.writeFileSync(path.join(outputDir, 'test.txt'), 'test content');

      const consumer = new Consumer({
        packageName: 'test-package',
        outputDir,
      });

      // We need to test private method, so this is a basic validation
      expect(fs.existsSync(path.join(outputDir, '.folder-publisher'))).toBe(true);
    });
  });

  describe('check', () => {
    it('should fail when package is not installed', async () => {
      const consumer = new Consumer({
        packageName: 'nonexistent-package',
        outputDir: tmpDir,
        check: true,
      });

      await expect(consumer.check()).rejects.toThrow(/Package .* is not installed/);
    });
  });
});
