import { Injectable } from '@drogonjs/common';

export interface AppInfo {
  name: string;
  status: 'ok';
  uptimeSeconds: number;
}

@Injectable()
export class AppService {
  private readonly startedAt = Date.now();

  info(): AppInfo {
    return {
      name: '__PROJECT_NAME__',
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000)
    };
  }

  greet(name: string) {
    return { message: `Hello, ${name}!` };
  }
}
