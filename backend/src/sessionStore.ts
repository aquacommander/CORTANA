import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Session } from '../../frontend/shared/contracts.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'sessions.json');

type SerializedStore = {
  sessions: Session[];
};

export class SessionStore {
  private sessions = new Map<string, Session>();

  async initialize(): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    try {
      const raw = await readFile(STORE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as SerializedStore;
      for (const session of parsed.sessions || []) {
        this.sessions.set(session.sessionId, session);
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
      await this.flush();
    }
  }

  get size(): number {
    return this.sessions.size;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getAll(): Session[] {
    return Array.from(this.sessions.values());
  }

  async set(session: Session): Promise<void> {
    this.sessions.set(session.sessionId, session);
    await this.flush();
  }

  async flush(): Promise<void> {
    const payload: SerializedStore = { sessions: Array.from(this.sessions.values()) };
    await writeFile(STORE_FILE, JSON.stringify(payload, null, 2), 'utf8');
  }
}
