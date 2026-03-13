import fs from 'node:fs';
import path from 'node:path';

import { ManagedFileMetadata } from '../types';
import { ensureDir } from '../utils';

import { MARKER_FILE } from './constants';

/**
 * Read all managed file entries from a .npmdata marker file.
 * Format: path|packageName|packageVersion — one row per file, no header.
 * Pipe is used as separator so file paths containing commas are handled safely.
 */
export async function readMarker(markerFilePath: string): Promise<ManagedFileMetadata[]> {
  if (!fs.existsSync(markerFilePath)) {
    return [];
  }
  const content = fs.readFileSync(markerFilePath, 'utf8');
  const lines = content.split('\n').filter((line) => line.trim() !== '');
  return lines.map((line) => {
    const fields = line.split('|');
    return {
      path: fields[0] ?? '',
      packageName: fields[1] ?? '',
      packageVersion: fields[2] ?? '',
    };
  });
}

/**
 * Write managed file entries to a .npmdata marker file.
 * Format: path|packageName|packageVersion — one row per file, no header.
 * Makes the file read-only after writing.
 */
export async function writeMarker(
  markerFilePath: string,
  entries: ManagedFileMetadata[],
): Promise<void> {
  ensureDir(path.dirname(markerFilePath));
  // Make writable if it already exists
  if (fs.existsSync(markerFilePath)) {
    fs.chmodSync(markerFilePath, 0o644);
  }
  if (entries.length === 0) {
    // Remove empty marker
    if (fs.existsSync(markerFilePath)) {
      fs.unlinkSync(markerFilePath);
    }
    return;
  }
  const rows = entries.map((e) => `${e.path}|${e.packageName}|${e.packageVersion}`);
  fs.writeFileSync(markerFilePath, `${rows.join('\n')}\n`, 'utf8');
  fs.chmodSync(markerFilePath, 0o444);
}

/**
 * Returns the path of the .npmdata marker file for a given output directory.
 */
export function markerPath(outputDir: string): string {
  return path.join(outputDir, MARKER_FILE);
}

/**
 * Read all managed file entries from an output directory's .npmdata marker.
 */
export async function readOutputDirMarker(outputDir: string): Promise<ManagedFileMetadata[]> {
  return readMarker(markerPath(outputDir));
}
