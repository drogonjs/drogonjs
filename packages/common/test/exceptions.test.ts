import { describe, expect, it } from 'bun:test';
import { BadRequestException, HttpException, NotFoundException } from '../src/index';

describe('HttpException', () => {
  it('keeps subclasses identifiable with instanceof', () => {
    const error = new NotFoundException('missing');

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error).toBeInstanceOf(HttpException);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BadRequestException);
  });

  it('serialises status and payload', () => {
    expect(new NotFoundException('missing').toJSON()).toEqual({ statusCode: 404, message: 'missing' });
    expect(new HttpException(409, { message: 'taken', field: 'email' }).toJSON()).toEqual({
      statusCode: 409,
      message: 'taken',
      field: 'email'
    });
  });

  it('carries a cause', () => {
    const cause = new Error('root');
    expect(new BadRequestException('bad', { cause }).cause).toBe(cause);
  });
});
