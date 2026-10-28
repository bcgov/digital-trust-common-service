import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { TenantRepository } from '../tenant/tenant.repository';
import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from '../tenant-user/tenant-user.entity';
import { TenantUserRepository } from '../tenant-user/tenant-user.repository';

/**
 * The seed's own writes to tenant_user. They live here rather than on
 * TenantUserRepository because they encode rules only the seed has: which
 * subject it gave a row, and which columns are its to refresh.
 */
@Injectable()
export class SeedTenantUserRepository {
  public constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenants: TenantRepository,
    private readonly tenantUsers: TenantUserRepository,
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
    return await this.withTenantAdminGuard(tenantId, async (manager) => {
      const result = await manager
        .getRepository(TenantUser)
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
    });
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
    return await this.withTenantAdminGuard(tenantId, async (manager) => {
      const result = await manager
        .getRepository(TenantUser)
        .update({ tenantId, email }, { displayName, role });

      return (result.affected ?? 0) > 0;
    });
  }

  /**
   * Makes the user at this tenant and email an owner and platform operator,
   * matching the email case-insensitively and touching nothing else, so a
   * claimed row keeps its name and subject. Unguarded, unlike the writes
   * above: promoting to owner cannot remove one. Returns whether a row changed.
   */
  public async ensurePlatformOperator(
    tenantId: string,
    email: string,
  ): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(TenantUser)
      .createQueryBuilder()
      .update(TenantUser)
      .set({ role: TenantUserRole.OWNER, isPlatformOperator: true })
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(email) = LOWER(:email)', { email })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  private async withTenantAdminGuard(
    tenantId: string,
    update: (manager: EntityManager) => Promise<boolean>,
  ): Promise<boolean> {
    return await this.dataSource.transaction(async (manager) => {
      await this.tenants.findByIdForUpdate(tenantId, manager);
      const administratorCountBefore =
        await this.tenantUsers.countActiveAdministratorsByTenant(
          tenantId,
          manager,
        );
      const ownerCountBefore = await this.tenantUsers.countByTenantAndRole(
        tenantId,
        TenantUserRole.OWNER,
        manager,
      );
      const activeOwnerCountBefore =
        await this.tenantUsers.countActiveOwnersByTenant(tenantId, manager);
      const changed = await update(manager);

      if (changed) {
        const ownerCountAfter = await this.tenantUsers.countByTenantAndRole(
          tenantId,
          TenantUserRole.OWNER,
          manager,
        );

        if (ownerCountBefore > 0 && ownerCountAfter === 0) {
          throw new ConflictException("Cannot remove the tenant's last owner.");
        }

        const activeOwnerCountAfter =
          await this.tenantUsers.countActiveOwnersByTenant(tenantId, manager);

        if (activeOwnerCountBefore > 0 && activeOwnerCountAfter === 0) {
          throw new ConflictException(
            "Cannot remove the tenant's last active owner.",
          );
        }

        if (administratorCountBefore > 0) {
          const administratorCountAfter =
            await this.tenantUsers.countActiveAdministratorsByTenant(
              tenantId,
              manager,
            );

          if (administratorCountAfter === 0) {
            throw new ConflictException(
              "Cannot remove the tenant's last active administrator.",
            );
          }
        }
      }

      return changed;
    });
  }
}
