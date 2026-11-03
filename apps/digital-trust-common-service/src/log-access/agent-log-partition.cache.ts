import { Injectable } from '@nestjs/common';

export const AGENT_PARTITION_CACHE_TTL_MS = 300_000;
export const AGENT_PARTITION_CACHE_MAX_ENTRIES = 1_000;

interface CacheEntry {
  partitions: string[];
  expiresAt: number;
}

export interface AgentLogPartitionLookup {
  generation: number;
  startedAt: number;
}

/**
 * Bounded positive cache of resolved agent partitions, keyed only by tenant
 * id (Rules M10–M12). Insertion order doubles as age, so the oldest entry
 * is evicted when the cache is full.
 */
@Injectable()
export class AgentLogPartitionCache {
  private readonly entries = new Map<string, CacheEntry>();
  // Bumped on every invalidation; any invalidation (even for another
  // tenant) only causes a harmless cache miss for in-flight lookups.
  private generation = 0;

  /** Call before reading the datastore so a stale result can be rejected. */
  public beginLookup(): AgentLogPartitionLookup {
    return { generation: this.generation, startedAt: Date.now() };
  }

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

  public set(
    tenantId: string,
    partitions: string[],
    lookup: AgentLogPartitionLookup = this.beginLookup(),
  ): void {
    const expiresAt = lookup.startedAt + AGENT_PARTITION_CACHE_TTL_MS;

    if (expiresAt <= Date.now()) {
      throw new Error(
        'Agent partition lookup exceeded the maximum staleness window.',
      );
    }

    if (lookup.generation !== this.generation) {
      return;
    }

    this.entries.delete(tenantId);

    if (this.entries.size >= AGENT_PARTITION_CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) {
        this.entries.delete(oldest.value);
      }
    }

    this.entries.set(tenantId, {
      partitions: [...partitions],
      expiresAt,
    });
  }

  public invalidate(tenantId: string): void {
    this.generation += 1;
    this.entries.delete(tenantId);
  }
}
