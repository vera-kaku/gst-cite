import fs from 'node:fs';
import path from 'node:path';
import type { GuidanceUpdate, Snapshot } from './types.ts';

export class Store {
  constructor(readonly dir = process.env.DATA_DIR ?? path.resolve('data')) {}

  private get snapDir() {
    return path.join(this.dir, 'snapshots');
  }

  listSnapshotIds(): string[] {
    if (!fs.existsSync(this.snapDir)) return [];
    return fs
      .readdirSync(this.snapDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  }

  readSnapshot(id: string): Snapshot {
    return JSON.parse(fs.readFileSync(path.join(this.snapDir, `${id}.json`), 'utf8'));
  }

  latest(): Snapshot | null {
    const ids = this.listSnapshotIds();
    return ids.length ? this.readSnapshot(ids[ids.length - 1]!) : null;
  }

  previous(): Snapshot | null {
    const ids = this.listSnapshotIds();
    return ids.length > 1 ? this.readSnapshot(ids[ids.length - 2]!) : null;
  }

  writeSnapshot(s: Snapshot) {
    fs.mkdirSync(this.snapDir, { recursive: true });
    fs.writeFileSync(path.join(this.snapDir, `${s.id}.json`), JSON.stringify(s));
  }

  readUpdates(): GuidanceUpdate[] {
    const f = path.join(this.dir, 'updates.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  }

  appendUpdates(items: GuidanceUpdate[]) {
    fs.mkdirSync(this.dir, { recursive: true });
    const all = [...items, ...this.readUpdates()];
    fs.writeFileSync(path.join(this.dir, 'updates.json'), JSON.stringify(all, null, 1));
  }
}

/** Snapshot ids sort by time and are safe as file names. */
export const newSnapshotId = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-');
