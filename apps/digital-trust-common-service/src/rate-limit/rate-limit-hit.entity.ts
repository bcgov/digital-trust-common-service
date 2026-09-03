import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One row per request admitted through `TenantRateLimitGuard`. Insert-only;
 * rows are counted within a sliding window to enforce the limit and pruned
 * by `RateLimitPruneWorker` once they fall outside every configured window.
 */
@Entity({ name: 'rate_limit_hits' })
@Index('idx_rate_limit_hits_tracker_route_hit_at', [
  'tracker',
  'routeKey',
  'hitAt',
])
@Index('idx_rate_limit_hits_hit_at', ['hitAt'])
export class RateLimitHit {
  @ApiProperty({
    description: 'The unique identifier of the rate limit hit',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @ApiProperty({
    description:
      'Identifies who this request is attributed to: a tenant id for ' +
      'tenant-scoped routes, or the caller IP for routes with no tenant ' +
      '(e.g. platform-admin/global endpoints). Not a foreign key — the ' +
      'value is opaque and may not correspond to any tenant row.',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ name: 'tracker', type: 'text' })
  public tracker!: string;

  @ApiProperty({
    description:
      'Identifies which rate limit bucket this hit counts against ' +
      "(e.g. 'global' or a specific overridden route)",
    example: 'global',
  })
  @Column({ name: 'route_key', type: 'text' })
  public routeKey!: string;

  @ApiProperty({
    description: 'The date and time the request was admitted',
    example: '2024-01-01T00:00:00Z',
  })
  @CreateDateColumn({
    name: 'hit_at',
    type: 'timestamptz',
  })
  public hitAt!: Date;
}
