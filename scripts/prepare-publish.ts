/**
 * Runs in CI right before `changeset publish`. npm provenance requires each
 * package's `repository.url` to match the GitHub repository that built it, so
 * packages without a `repository` field get one derived from
 * `GITHUB_REPOSITORY`. Only the CI checkout is changed; nothing is committed.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repository = process.env.GITHUB_REPOSITORY;
const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
const root = join(import.meta.dir, '..');

for (const name of readdirSync(join(root, 'packages'))) {
  const file = join(root, 'packages', name, 'package.json');
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (pkg.private) continue;

  // A package that ships `dist` and has none has not been built.
  if (pkg.files?.includes('dist') && !existsSync(join(root, 'packages', name, 'dist'))) {
    throw new Error(`${pkg.name}: dist/ is missing, run \`bun run build\` first`);
  }

  if (pkg.repository || !repository) continue;
  pkg.repository = { type: 'git', url: `git+${server}/${repository}.git`, directory: `packages/${name}` };
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${pkg.name}: repository set to ${repository}`);
}
