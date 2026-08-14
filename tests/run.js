#!/usr/bin/env node
/**
 * `node tests/run.js` — imports every `*.test.js` beside it and exits non-zero
 * if anything failed. Pass a substring to run only matching files.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { report } from './harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2];

const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.js'))
  .filter((f) => !filter || f.includes(filter))
  .sort();

if (!files.length) {
  console.error(filter ? `no test files match "${filter}"` : 'no test files found');
  process.exit(1);
}

for (const file of files) {
  await import(pathToFileURL(join(here, file)).href);
}

process.exit(report());
