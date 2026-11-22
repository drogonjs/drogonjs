import { join, relative, resolve } from 'node:path';
import { cancel, confirm, intro, log, note, outro, spinner } from '@clack/prompts';
import { bold, cyan, dim } from './colors.mjs';
import { CreateError } from './errors.mjs';
import { ask, collectAnswers } from './prompts.mjs';
import { inspectDirectory, scaffold } from './scaffold.mjs';
import { initGit, installDependencies, runScriptHint } from './system.mjs';

// Re-exported so the bin keeps a single import for the scaffolder's API.
export { CreateError };

function label(cwd, target) {
  const rel = relative(cwd, target);
  return rel === '' ? '.' : rel;
}

function lastLines(text, count) {
  const lines = text.split('\n').filter(Boolean);
  return lines.slice(-count).join('\n');
}

async function ensureTarget(target, name, { force, interactive }) {
  const state = await inspectDirectory(target);
  if (!state.exists || state.empty) return;

  if (force) {
    log.warn(`${name} is not empty — files of the same name will be overwritten.`);
    return;
  }

  if (!interactive) {
    throw new CreateError(
      `${name} is not empty (${state.entries.length} entries). Re-run with --force to scaffold into it anyway.`
    );
  }

  const proceed = await ask(
    confirm({
      message: `${name} is not empty. Overwrite the files that collide?`,
      initialValue: false
    })
  );

  if (!proceed) {
    cancel('Nothing was written.');
    process.exit(1);
  }
}

export async function runCreate(cli, { cwd, templatesDir, version }) {
  const interactive = !cli.yes;

  // Clack needs a TTY to read answers; a pipe would otherwise hang forever.
  if (interactive && !process.stdin.isTTY) {
    throw new CreateError(
      'Standard input is not interactive. Pass --yes (plus any flags) to scaffold without prompts.'
    );
  }

  intro(`${bold('create-drogonjs')} ${dim(`v${version}`)}`);

  let target;
  const answers = await collectAnswers(cli, {
    cwd,
    onProjectName: async name => {
      target = resolve(cwd, name);
      await ensureTarget(target, label(cwd, target), { force: cli.force, interactive });
    }
  });

  const destination = label(cwd, target);
  const progress = spinner();

  progress.start('Creating project files');
  let files;
  try {
    files = await scaffold({
      templateDir: join(templatesDir, answers.adapter),
      target,
      projectName: answers.packageName,
      features: { openapi: answers.openapi, tests: answers.tests }
    });
  } catch (error) {
    progress.stop('Could not create project files', 1);
    throw error;
  }
  progress.stop(`Created ${files.length} files in ${destination}`);

  let installed = false;
  if (answers.install) {
    progress.start(`Installing dependencies with ${answers.packageManager}`);
    const result = await installDependencies(answers.packageManager, target);
    if (result.ok) {
      installed = true;
      progress.stop(`Installed dependencies with ${answers.packageManager}`);
    } else {
      progress.stop(`${answers.packageManager} install failed`, 1);
      if (result.output) log.message(dim(lastLines(result.output, 8)));
    }
  }

  if (answers.git) {
    const result = await initGit(target);
    if (result.ok && result.committed) {
      log.success('Initialised a git repository with the scaffold as its first commit.');
    } else if (result.ok) {
      log.warn(`Initialised a git repository — ${result.reason}.`);
    } else {
      log.warn(`Skipped git init — ${result.reason}.`);
    }
  }

  const steps = [];
  if (destination !== '.') steps.push(`cd ${destination}`);
  if (!installed) steps.push(`${answers.packageManager} install`);
  steps.push(runScriptHint(answers.packageManager, 'dev'));
  if (answers.tests) steps.push(runScriptHint(answers.packageManager, 'test'));

  note(steps.map(step => cyan(step)).join('\n'), 'Next steps');

  const endpoints = ['http://localhost:3000'];
  if (answers.openapi) endpoints.push('http://localhost:3000/openapi');
  outro(`${bold('Ready.')} ${dim(endpoints.join('  •  '))}`);
}
