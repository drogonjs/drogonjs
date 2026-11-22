#!/usr/bin/env bun
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { generateFiles, isSchematic, SCHEMATICS } from '../dist/index.js';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(arg => arg.startsWith('-')));
const [command, schematic, name] = argv.filter(arg => !arg.startsWith('-'));

const dryRun = flags.has('--dry-run') || flags.has('-d');
const force = flags.has('--force') || flags.has('-f');

function printHelp() {
  console.log(`Drogon CLI

Usage:
  drogon generate <schematic> <name>
  drogon g <schematic> <name>

Schematics:
${SCHEMATICS.map(schematic => `  ${schematic}`).join('\n')}

Options:
  -d, --dry-run   print the files that would be created
  -f, --force     overwrite files that already exist
  -h, --help      show this message`);
}

if (!command || flags.has('--help') || flags.has('-h')) {
  printHelp();
  process.exit(0);
}

if (!['generate', 'g'].includes(command)) {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

if (!schematic || !name) {
  printHelp();
  process.exit(1);
}

// Validated here so an unknown schematic reports itself instead of reaching the
// generator and failing on an empty result.
if (!isSchematic(schematic)) {
  console.error(`Unknown schematic: ${schematic}`);
  console.error(`Available schematics: ${SCHEMATICS.join(', ')}`);
  process.exit(1);
}

let files;
try {
  files = generateFiles(schematic, name);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

let created = 0;
let skipped = 0;

for (const file of files) {
  const target = resolve(process.cwd(), file.path);

  if (dryRun) {
    console.log(`[dry-run] ${file.path}`);
    continue;
  }

  await mkdir(dirname(target), { recursive: true });

  try {
    // 'wx' fails rather than truncating, so re-running a schematic can never
    // silently eat code that was written into a generated file.
    await writeFile(target, file.content, { encoding: 'utf8', flag: force ? 'w' : 'wx' });
    console.log(`CREATE ${file.path}`);
    created++;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    console.error(`SKIP   ${file.path} (already exists — pass --force to overwrite)`);
    skipped++;
  }
}

if (!created && skipped) process.exit(1);
