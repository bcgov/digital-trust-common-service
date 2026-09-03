import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from '../tenant-user/tenant-user.entity';

/**
 * The seed's own writes to tenant_user. They live here rather than on
 * TenantUserRepository because they encode rules only the seed has: which
 * subject it gave a row, and which columns are its to refresh.
 */
@Injectable()
export class SeedTenantUserRepository {
  public constructor(
    @InjectRepository(TenantUser)
    private readonly repository: Repository<TenantUser>,
  ) {}

  /**
   * Refreshes a seeded user's status, display name and role in one
   * statement, only while the row still carries the subject the seed gave
   * it: none for an invitation, the placeholder for a list-only user. A row
   * a sign-in has claimed does not match, so the claim cannot be undone.
   * Returns whether a row changed.
   */
  public async refreshSeeded(
    tenantId: string,
    email: string,
    fields: {
      externalUserId: string | null;
      status: TenantUserStatus;
      displayName: string;
      role: TenantUserRole;
    },
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(TenantUser)
      .set({
        status: fields.status,
        displayName: fields.displayName,
        role: fields.role,
      })
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('email = :email', { email })
      .andWhere('external_user_id IS NOT DISTINCT FROM :externalUserId', {
        externalUserId: fields.externalUserId,
      })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /**
   * Refreshes only the display name and role of the user at this tenant and
   * email, in one statement, so nothing else on a claimed row is touched.
   * Returns whether a row changed.
   */
  public async setDisplayNameAndRole(
    tenantId: string,
    email: string,
    displayName: string,
    role: TenantUserRole,
  ): Promise<boolean> {
    const result = await this.repository.update(
      { tenantId, email },
      { displayName, role },
    );

    return (result.affected ?? 0) > 0;
  }
}
