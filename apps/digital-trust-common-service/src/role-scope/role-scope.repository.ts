import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Resolves tenant-user role → scope mappings from the `role_scope` table.
 * Used by OIDC token issuance for interactive user tokens (AU-02 hook).
 */
@Injectable()
export class RoleScopeRepository {
  public constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  public async findScopesForRole(role: string): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ scope: string }>>(
      `SELECT scope FROM role_scope WHERE role = $1::tenant_user_role ORDER BY scope`,
      [role],
    );

    return rows.map((row) => row.scope);
  }
}
