import { basename } from 'node:path';
import { cancel, confirm, isCancel, log, select, text } from '@clack/prompts';
import { PACKAGE_MANAGERS } from './args.mjs';
import { CreateError } from './errors.mjs';
import { detectPackageManager } from './system.mjs';

const DEFAULT_NAME = 'drogon-app';

/** The npm registry's own package-name grammar, scoped names included. */
const NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export function validateProjectName(value) {
  const name = (value ?? '').trim();
  if (!name) return 'Please enter a project name.';
  // `.` scaffolds into the current directory, so it never has to be a valid name.
  if (name === '.') return undefined;
  if (name.length > 214) return 'Name must be 214 characters or fewer.';
  if (/[A-Z]/.test(name)) return 'Name must be lowercase.';
  if (!NAME_PATTERN.test(name)) {
    return 'Use lowercase letters, digits, dashes or dots (an optional @scope/ is allowed).';
  }
  return undefined;
}

/** Derives the `name` field of the generated manifest from the target directory. */
export function toPackageName(value, cwd) {
  const raw = value === '.' ? basename(cwd) : value;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9\-._~/@]+/g, '-')
    .replace(/^[-_.]+/, '')
    .replace(/[-.]+$/, '');
  return NAME_PATTERN.test(cleaned) ? cleaned : DEFAULT_NAME;
}

export async function ask(prompt) {
  const value = await prompt;
  if (isCancel(value)) {
    cancel('Scaffolding cancelled — nothing was written.');
    process.exit(130);
  }
  return value;
}

/**
 * A flag always wins over a prompt, and `--yes` answers whatever is left with the
 * documented default. `??` short-circuits, so no question is even constructed
 * when the answer is already known.
 */
async function decide(flag, fallback) {
  return flag ?? (await fallback());
}

export async function collectAnswers(cli, { cwd, onProjectName }) {
  const projectName = await decide(cli.projectName, () =>
    cli.yes
      ? DEFAULT_NAME
      : ask(
          text({
            message: 'Where should the project live?',
            // Pre-filled rather than a placeholder: clack validates the raw input,
            // so a bare Enter on an empty field would trip the "required" check.
            initialValue: DEFAULT_NAME,
            validate: validateProjectName
          })
        )
  );

  const nameError = validateProjectName(projectName);
  if (nameError) throw new CreateError(`Invalid project name "${projectName}": ${nameError}`);

  // The destination is vetted before the remaining questions, so an occupied
  // directory is reported while there is still nothing to undo.
  if (onProjectName) await onProjectName(projectName);

  const adapter = await decide(cli.adapter, () =>
    cli.yes
      ? 'elysia'
      : ask(
          select({
            message: 'Which HTTP adapter?',
            initialValue: 'elysia',
            options: [
              { value: 'elysia', label: 'Elysia', hint: 'schemas, OpenAPI, fastest on Bun' },
              { value: 'hono', label: 'Hono', hint: 'tiny, portable across runtimes' }
            ]
          })
        )
  );

  // @drogonjs/openapi wraps @elysia/openapi, so it has no meaning on Hono.
  let openapi = false;
  if (adapter === 'elysia') {
    openapi = await decide(cli.openapi, () =>
      cli.yes
        ? true
        : ask(confirm({ message: 'Serve an OpenAPI document at /openapi?', initialValue: true }))
    );
  } else if (cli.openapi) {
    log.warn('--openapi only applies to the Elysia adapter; ignoring it.');
  }

  const tests = await decide(cli.tests, () =>
    cli.yes
      ? true
      : ask(confirm({ message: 'Add @drogonjs/testing and an example spec?', initialValue: true }))
  );

  const install = await decide(cli.install, () =>
    cli.yes ? true : ask(confirm({ message: 'Install dependencies now?', initialValue: true }))
  );

  const detected = detectPackageManager();
  const packageManager = await decide(cli.packageManager, () =>
    cli.yes || !install
      ? detected
      : ask(
          select({
            message: 'Which package manager?',
            initialValue: detected,
            options: PACKAGE_MANAGERS.map(value => ({
              value,
              label: value,
              hint: value === detected ? 'detected' : undefined
            }))
          })
        )
  );

  const git = await decide(cli.git, () =>
    cli.yes ? true : ask(confirm({ message: 'Initialise a git repository?', initialValue: true }))
  );

  return {
    projectName,
    packageName: toPackageName(projectName, cwd),
    adapter,
    openapi,
    tests,
    install,
    packageManager,
    git
  };
}
