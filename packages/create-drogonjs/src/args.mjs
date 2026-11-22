import { parseArgs } from 'node:util';

export const ADAPTERS = ['elysia', 'hono'];
export const PACKAGE_MANAGERS = ['bun', 'npm', 'pnpm', 'yarn'];

const OPTIONS = {
  adapter: { type: 'string' },
  pm: { type: 'string' },
  openapi: { type: 'boolean' },
  tests: { type: 'boolean' },
  install: { type: 'boolean' },
  git: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  force: { type: 'boolean', short: 'f' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' }
};

const NEGATABLE = ['openapi', 'tests', 'install', 'git'];

export class UsageError extends Error {}

/**
 * `parseArgs` has no notion of `--no-<flag>`, so negations are lifted out of
 * argv first and folded back in as explicit `false` values afterwards.
 */
function extractNegations(argv) {
  const negated = new Set();
  const rest = [];

  for (const arg of argv) {
    const match = /^--no-([a-z][a-z-]*)$/.exec(arg);
    if (!match) {
      rest.push(arg);
      continue;
    }
    if (!NEGATABLE.includes(match[1])) {
      throw new UsageError(`Unknown option: ${arg}`);
    }
    negated.add(match[1]);
  }

  return { negated, rest };
}

function oneOf(name, value, allowed) {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) {
    throw new UsageError(`Invalid --${name}: ${value}. Expected one of ${allowed.join(', ')}.`);
  }
  return value;
}

export function parseCliArgs(argv) {
  const { negated, rest } = extractNegations(argv);

  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error.message);
  }

  const values = { ...parsed.values };
  for (const name of negated) values[name] = false;

  if (parsed.positionals.length > 1) {
    throw new UsageError(`Expected a single project name, received ${parsed.positionals.length}.`);
  }

  return {
    projectName: parsed.positionals[0],
    adapter: oneOf('adapter', values.adapter, ADAPTERS),
    packageManager: oneOf('pm', values.pm, PACKAGE_MANAGERS),
    openapi: values.openapi,
    tests: values.tests,
    install: values.install,
    git: values.git,
    yes: values.yes ?? false,
    force: values.force ?? false,
    help: values.help ?? false,
    version: values.version ?? false
  };
}

export function helpText() {
  return `create-drogonjs

Scaffold a DrogonJS application.

Usage
  bun create drogonjs [name] [options]
  bunx create-drogonjs [name] [options]

Options
  --adapter <${ADAPTERS.join('|')}>   HTTP adapter to scaffold
  --pm <${PACKAGE_MANAGERS.join('|')}>    package manager used to install
  --openapi, --no-openapi         serve an OpenAPI document (Elysia only)
  --tests, --no-tests             include @drogonjs/testing and a sample spec
  --install, --no-install         install dependencies after scaffolding
  --git, --no-git                 initialise a git repository
  -y, --yes                       accept every default, ask nothing
  -f, --force                     scaffold into a non-empty directory
  -v, --version                   print the version
  -h, --help                      print this message

Examples
  bun create drogonjs my-api
  bun create drogonjs my-api --adapter hono --no-openapi
  bun create drogonjs my-api --yes --pm pnpm`;
}
