import { spawn } from 'node:child_process';
import { PACKAGE_MANAGERS } from './args.mjs';

/**
 * npm, pnpm and yarn ship as `.cmd` shims on Windows, which `spawn` cannot
 * execute without a shell. Every command name used here comes from a fixed
 * whitelist and no argument is interpolated, so the shell has nothing to
 * mis-parse. Paths travel through the `cwd` option rather than as arguments.
 */
const useShell = process.platform === 'win32';

/** Never rejects: the caller decides whether a non-zero exit is fatal. */
export function run(command, args, cwd) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd,
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ADBLOCK: '1', DISABLE_OPENCOLLECTIVE: '1' }
    });

    let output = '';
    const collect = chunk => {
      output += chunk;
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    child.on('error', error => resolve({ ok: false, output: error.message }));
    child.on('close', code => resolve({ ok: code === 0, output: output.trim() }));
  });
}

export async function hasCommand(command) {
  const { ok } = await run(command, ['--version'], process.cwd());
  return ok;
}

/**
 * `npm_config_user_agent` is set by every major package manager and starts with
 * `<name>/<version>`, so the runner that invoked `create-drogonjs` is also the
 * one used to install.
 */
export function detectPackageManager() {
  const agent = process.env.npm_config_user_agent ?? '';
  const name = agent.split('/')[0];
  return PACKAGE_MANAGERS.includes(name) ? name : 'bun';
}

export function installDependencies(packageManager, cwd) {
  return run(packageManager, ['install'], cwd);
}

export function runScriptHint(packageManager, script) {
  return packageManager === 'npm' ? `npm run ${script}` : `${packageManager} ${script}`;
}

/**
 * Initialises a repository and lands the scaffold as the first commit. Nesting a
 * repository inside an existing one is almost never intended, so that case is
 * skipped rather than silently creating a second work tree.
 */
export async function initGit(cwd) {
  if (!(await hasCommand('git'))) {
    return { ok: false, committed: false, reason: 'git is not installed' };
  }

  const inside = await run('git', ['rev-parse', '--is-inside-work-tree'], cwd);
  if (inside.ok && inside.output === 'true') {
    return { ok: false, committed: false, reason: 'already inside a git repository' };
  }

  // `-b` needs git 2.28+; older versions fall back to whatever init.defaultBranch is.
  let init = await run('git', ['init', '-b', 'main'], cwd);
  if (!init.ok) init = await run('git', ['init'], cwd);
  if (!init.ok) {
    return { ok: false, committed: false, reason: init.output || 'git init failed' };
  }

  const added = await run('git', ['add', '-A'], cwd);
  if (!added.ok) {
    return { ok: true, committed: false, reason: added.output || 'git add failed' };
  }

  const committed = await run('git', ['commit', '-m', 'chore: scaffold DrogonJS app'], cwd);
  if (!committed.ok) {
    // Most often an unset user.name/user.email. The repository is still usable.
    return { ok: true, committed: false, reason: 'no commit created (is git user.name set?)' };
  }

  return { ok: true, committed: true };
}
