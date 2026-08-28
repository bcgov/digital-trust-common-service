import type {
  OidcCreateTenantUserInput,
  OidcTenantUserPort,
  OidcTenantUserRecord,
} from '@app/oidc';
import { Injectable, NotFoundException } from '@nestjs/common';

import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { TenantUserRole, TenantUserStatus } from './tenant-user.entity';
import { TenantUserService } from './tenant-user.service';

@Injectable()
export class OidcTenantUserAdapter implements OidcTenantUserPort {
  public constructor(private readonly tenantUserService: TenantUserService) {}

  public async findById(id: string): Promise<OidcTenantUserRecord | undefined> {
    return await this.tenantUserService.findById(id).catch((error: unknown) => {
      if (error instanceof NotFoundException) {
        return undefined;
      }

      throw error;
    });
  }

  public async findByTenantAndExternalUserId(
    tenantId: string,
    externalUserId: string,
  ): Promise<OidcTenantUserRecord | null> {
    return await this.tenantUserService.findByTenantAndExternalUserId(
      tenantId,
      externalUserId,
    );
  }

  public async findActiveByExternalUserId(
    externalUserId: string,
  ): Promise<OidcTenantUserRecord[]> {
    return await this.tenantUserService.findActiveByExternalUserId(
      externalUserId,
    );
  }

  public async claimInvitedByEmail(
    tenantId: string,
    email: string,
    externalUserId: string,
  ): Promise<OidcTenantUserRecord | null> {
    return await this.tenantUserService.claimInvitedByEmail(
      tenantId,
      email,
      externalUserId,
    );
  }

  public async create(
    input: OidcCreateTenantUserInput,
  ): Promise<OidcTenantUserRecord> {
    const dto: CreateTenantUserDto = {
      ...input,
      role: input.role as TenantUserRole,
      status: input.status as TenantUserStatus,
    };

    return await this.tenantUserService.create(dto);
  }
}
