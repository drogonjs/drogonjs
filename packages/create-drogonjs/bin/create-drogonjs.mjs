#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, helpText, parseCliArgs } from '../src/args.mjs';
import { CreateError, runCreate } from '../src/create.mjs';

// `fileURLToPath` rather than `new URL(...).pathname`: the latter leaves percent
// escapes in place, so an install path containing a space would not resolve.
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let cli;
try {
  cli = parseCliArgs(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  fail(`${error.message}\n\nRun \`create-drogonjs --help\` for the full list of options.`);
}

if (cli.help) {
  process.stdout.write(`${helpText()}\n`);
  process.exit(0);
}

if (cli.version) {
  process.stdout.write(`${manifest.version}\n`);
  process.exit(0);
}

try {
  await runCreate(cli, {
    cwd: process.cwd(),
    templatesDir: join(packageRoot, 'templates'),
    version: manifest.version
  });
} catch (error) {
  // Expected failures get a plain message; anything else keeps its stack so a
  // genuine bug in the scaffolder stays reportable.
  if (error instanceof CreateError) fail(`\n${error.message}`);
  fail(`\n${error?.stack ?? String(error)}`);
}
