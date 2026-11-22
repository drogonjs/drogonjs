import { describe, expect, it } from 'bun:test';
import { CreateError } from '../src/create.mjs';
import { collectAnswers } from '../src/prompts.mjs';

describe('collectAnswers', () => {
  it('reports an invalid project name as a CreateError, not a crash', async () => {
    const answers = collectAnswers({ projectName: 'Bad Name', yes: true }, { cwd: process.cwd() });

    await expect(answers).rejects.toBeInstanceOf(CreateError);
    await expect(answers).rejects.toThrow('Invalid project name "Bad Name"');
  });
});
