import Dexie, { type Table } from 'dexie';
import type { GameState } from '../state/gameState';

export const SAVE_VERSION = 1;
export const AUTO_SLOT = 'auto';

export interface SaveRecord {
  slot: string;
  version: number;
  savedAt: number;
  /** Denormalised for the title screen, so it can be shown without rehydrating. */
  summary: {
    level: number;
    shrines: number;
    playSeconds: number;
    biome: string;
  };
  state: GameState;
}

class SaveDatabase extends Dexie {
  saves!: Table<SaveRecord, string>;

  constructor() {
    super('tiny-planet-action-rpg');
    this.version(1).stores({ saves: 'slot, savedAt' });
  }
}

/**
 * Storage for player progress.
 *
 * IndexedDB (through Dexie) is the real store. Some browsers refuse it outright in
 * private windows, so there is a localStorage fallback: progress surviving a
 * refresh is the one thing this game genuinely cannot do without.
 */
class SaveStore {
  private db: SaveDatabase | null = null;
  private useFallback = false;

  private get fallbackKey(): string {
    return 'tiny-planet-action-rpg:saves';
  }

  private ensure(): SaveDatabase | null {
    if (this.useFallback) return null;
    if (this.db) return this.db;
    try {
      if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
      this.db = new SaveDatabase();
      return this.db;
    } catch {
      this.useFallback = true;
      return null;
    }
  }

  /** True when running on the localStorage fallback rather than IndexedDB. */
  get degraded(): boolean {
    return this.useFallback;
  }

  private readFallback(): Record<string, SaveRecord> {
    try {
      const raw = localStorage.getItem(this.fallbackKey);
      return raw ? (JSON.parse(raw) as Record<string, SaveRecord>) : {};
    } catch {
      return {};
    }
  }

  private writeFallback(records: Record<string, SaveRecord>): void {
    try {
      localStorage.setItem(this.fallbackKey, JSON.stringify(records));
    } catch {
      /* Out of quota or storage denied — nothing else we can do. */
    }
  }

  async put(record: SaveRecord): Promise<void> {
    const db = this.ensure();
    if (db) {
      try {
        await db.saves.put(record);
        return;
      } catch {
        this.useFallback = true;
      }
    }
    const records = this.readFallback();
    records[record.slot] = record;
    this.writeFallback(records);
  }

  async get(slot: string): Promise<SaveRecord | undefined> {
    const db = this.ensure();
    if (db) {
      try {
        return await db.saves.get(slot);
      } catch {
        this.useFallback = true;
      }
    }
    return this.readFallback()[slot];
  }

  async remove(slot: string): Promise<void> {
    const db = this.ensure();
    if (db) {
      try {
        await db.saves.delete(slot);
        return;
      } catch {
        this.useFallback = true;
      }
    }
    const records = this.readFallback();
    delete records[slot];
    this.writeFallback(records);
  }

  async list(): Promise<SaveRecord[]> {
    const db = this.ensure();
    if (db) {
      try {
        return await db.saves.toArray();
      } catch {
        this.useFallback = true;
      }
    }
    return Object.values(this.readFallback());
  }
}

export const saveStore = new SaveStore();
