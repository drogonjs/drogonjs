import { describe, expect, it } from 'bun:test';
import { generateFiles, isSchematic, SCHEMATICS } from '../src/index';

describe('@drogonjs/cli', () => {
  it('generates a module file', () => {
    const files = generateFiles('module', 'users');
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/modules/users/users.module.ts');
    expect(files[0].content).toContain('export class UsersModule');
  });

  it('generates a resource with controller and service wiring', () => {
    const files = generateFiles('resource', 'billing/invoices');
    expect(files.map(file => file.path)).toEqual([
      'src/modules/billing/invoices/invoices.module.ts',
      'src/modules/billing/invoices/invoices.service.ts',
      'src/modules/billing/invoices/invoices.controller.ts'
    ]);
    expect(files[0].content).toContain('providers: [InvoicesService]');
    expect(files[0].content).toContain('controllers: [InvoicesController]');
  });

  it('strips a file extension instead of turning it into a directory', () => {
    const files = generateFiles('service', 'users.ts');

    expect(files[0].path).toBe('src/modules/users/users.service.ts');
    expect(files[0].content).toContain('export class UsersService');
  });

  it('builds the class name from a dashed segment', () => {
    const files = generateFiles('controller', 'admin/user-profile');

    expect(files[0].path).toBe('src/modules/admin/user-profile/user-profile.controller.ts');
    expect(files[0].content).toContain('export class UserProfileController');
    expect(files[0].content).toContain("@Controller('/user-profile')");
  });

  it('reports an unknown schematic instead of returning nothing', () => {
    expect(() => generateFiles('nope' as never, 'users')).toThrow('Unknown schematic: nope');
  });

  it('recognises every advertised schematic', () => {
    expect(SCHEMATICS.every(isSchematic)).toBe(true);
    expect(isSchematic('nope')).toBe(false);
  });

  it('refuses names that would write outside src/modules', () => {
    expect(() => generateFiles('module', '../../etc')).toThrow('"." and ".." segments are not allowed');
    expect(() => generateFiles('module', 'users\\..\\..\\x')).toThrow('not allowed');
  });

  it('treats backslashes as path separators', () => {
    expect(generateFiles('module', 'billing\\invoices')[0]!.path).toBe('src/modules/billing/invoices/invoices.module.ts');
  });

  it('refuses a name that cannot become a class name', () => {
    expect(() => generateFiles('service', '2fa')).toThrow('must start with a letter');
    expect(() => generateFiles('service', '/')).toThrow('must start with a letter');
  });
});

describe('@drogonjs/cli enhancers', () => {
  it.each(['guard', 'interceptor', 'pipe', 'filter', 'middleware'] as const)('generates a %s', kind => {
    const [file] = generateFiles(kind, 'auth/session');
    expect(file!.path).toBe(`src/modules/auth/session/session.${kind}.ts`);
    expect(file!.content).toContain(`export class Session${kind[0]!.toUpperCase()}${kind.slice(1)}`);
  });
});
