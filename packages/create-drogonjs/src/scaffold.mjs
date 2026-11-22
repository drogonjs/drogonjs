import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * npm strips a literal `.gitignore` from published tarballs, so templates ship
 * dotfiles under a `_` prefix and they are renamed on the way out.
 */
const RENAME = new Map([
  ['_gitignore', '.gitignore'],
  ['_npmrc', '.npmrc'],
  ['_env', '.env']
]);

const TEMPLATED_REGIONS = /\.(ts|tsx|mts|js|mjs|md)$/;

/** `// #if x` in code, `<!-- #if x -->` in markdown; both may be negated with `!`. */
const REGION_OPEN = /^\s*(?:\/\/|<!--)\s*#if\s+(!?)(\w+)\s*(?:-->)?\s*$/;
const REGION_CLOSE = /^\s*(?:\/\/|<!--)\s*#endif\s*(?:-->)?\s*$/;

/**
 * Strips `#if <feature>` … `#endif` regions whose condition is false. Comment
 * markers are used so every template file stays valid on its own and can be
 * type-checked in place.
 */
export function applyRegions(source, features) {
  const output = [];
  const stack = [];

  for (const line of source.split('\n')) {
    const open = REGION_OPEN.exec(line);
    if (open) {
      const enabled = Boolean(features[open[2]]);
      stack.push(open[1] === '!' ? !enabled : enabled);
      continue;
    }
    if (REGION_CLOSE.test(line)) {
      if (!stack.length) throw new Error('Template has a #endif without a matching #if');
      stack.pop();
      continue;
    }
    if (stack.every(Boolean)) output.push(line);
  }

  if (stack.length) throw new Error('Template has an unterminated #if region');
  return output.join('\n');
}

/**
 * Optional dependencies are removed from the parsed object rather than by
 * editing text, so the emitted manifest is always valid JSON.
 */
export function prunePackageJson(source, features) {
  const pkg = JSON.parse(source);

  if (!features.openapi) {
    delete pkg.dependencies?.['@drogonjs/openapi'];
  }
  if (!features.tests) {
    delete pkg.devDependencies?.['@drogonjs/testing'];
    delete pkg.scripts?.test;
  }

  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function shouldSkip(relativePath, features) {
  if (!features.tests && relativePath.startsWith('test/')) return true;
  return false;
}

function render(relativePath, source, projectName, features) {
  let text = source.replaceAll('__PROJECT_NAME__', projectName);

  if (TEMPLATED_REGIONS.test(relativePath)) {
    // Removing a region leaves the blank lines that surrounded it behind.
    text = applyRegions(text, features).replace(/\n{3,}/g, '\n\n');
  }
  if (relativePath === 'package.json') {
    text = prunePackageJson(text, features);
  }

  return text;
}

async function* walk(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      yield* walk(join(dir, entry.name), relativePath);
    } else if (entry.isFile()) {
      yield relativePath;
    }
  }
}

/** `.git` is ignored so `create-drogonjs . --force` in a fresh clone reads as empty. */
export async function inspectDirectory(target) {
  try {
    const entries = await readdir(target);
    const meaningful = entries.filter(entry => entry !== '.git' && entry !== '.DS_Store');
    return { exists: true, empty: meaningful.length === 0, entries: meaningful };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, empty: true, entries: [] };
    throw error;
  }
}

function targetName(relativePath) {
  const segments = relativePath.split('/');
  const last = segments.at(-1);
  return [...segments.slice(0, -1), RENAME.get(last) ?? last].join('/');
}

/** Returns the project-relative paths that were written, sorted for display. */
export async function scaffold({ templateDir, target, projectName, features }) {
  const written = [];

  await mkdir(target, { recursive: true });

  for await (const relativePath of walk(templateDir)) {
    if (shouldSkip(relativePath, features)) continue;

    const source = await readFile(join(templateDir, relativePath), 'utf8');
    const outputPath = targetName(relativePath);
    const absolute = join(target, outputPath);

    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, render(relativePath, source, projectName, features), 'utf8');
    written.push(outputPath);
  }

  return written.sort();
}
