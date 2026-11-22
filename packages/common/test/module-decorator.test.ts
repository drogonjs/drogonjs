import { describe, expect, it } from 'bun:test';
import { Global, Module, getModuleMetadata } from '../src/index';

class Service {}

@Global()
@Module({ providers: [Service] })
class GlobalFirstModule {}

@Module({ providers: [Service] })
@Global()
class ModuleFirstModule {}

@Module({ providers: [Service] })
class PlainModule {}

describe('@Module and @Global composition', () => {
  it('keeps global regardless of decorator order', () => {
    expect(getModuleMetadata(GlobalFirstModule).global).toBe(true);
    expect(getModuleMetadata(ModuleFirstModule).global).toBe(true);
  });

  it('preserves the declared providers alongside global', () => {
    expect(getModuleMetadata(ModuleFirstModule).providers).toEqual([Service]);
  });

  it('leaves an undecorated module non-global', () => {
    expect(getModuleMetadata(PlainModule).global).toBe(false);
  });
});
