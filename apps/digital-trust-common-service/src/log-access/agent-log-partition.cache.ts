import { Injectable } from '@nestjs/common';

export const AGENT_PARTITION_CACHE_TTL_MS = 300_000;
export const AGENT_PARTITION_CACHE_MAX_ENTRIES = 1_000;

interface CacheEntry {
  partitions: string[];
  expiresAt: number;
}

/**
 * Bounded positive cache of resolved agent partitions, keyed only by tenant
 * id (Rules M10–M12). Insertion order doubles as age, so the oldest entry
 * is evicted when the cache is full.
 */
@Injectable()
export class AgentLogPartitionCache {
  private readonly entries = new Map<string, CacheEntry>();

  public get(tenantId: string): string[] | undefined {
    const entry = this.entries.get(tenantId);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(tenantId);
      return undefined;
    }

    return [...entry.partitions];
  }

  public set(tenantId: string, partitions: string[]): void {
    this.entries.delete(tenantId);

    if (this.entries.size >= AGENT_PARTITION_CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) {
        this.entries.delete(oldest.value);
      }
    }

    this.entries.set(tenantId, {
      partitions: [...partitions],
      expiresAt: Date.now() + AGENT_PARTITION_CACHE_TTL_MS,
    });
  }

  public invalidate(tenantId: string): void {
    this.entries.delete(tenantId);
  }
}
