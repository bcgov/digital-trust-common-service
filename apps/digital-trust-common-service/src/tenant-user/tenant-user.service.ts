import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';
import { TenantUser } from './tenant-user.entity';
import { TenantUserRepository } from './tenant-user.repository';

@Injectable()
export class TenantUserService {
  public constructor(
    private readonly tenantUserRepository: TenantUserRepository,
  ) {}

  public async create(dto: CreateTenantUserDto): Promise<TenantUser> {
    const existing =
      await this.tenantUserRepository.findByTenantAndExternalUserId(
        dto.tenantId,
        dto.externalUserId,
      );

    if (existing) {
      throw new ConflictException('User already belongs to this tenant.');
    }

    return await this.tenantUserRepository.create({
      tenantId: dto.tenantId,
      externalUserId: dto.externalUserId,
      email: dto.email,
      displayName: dto.displayName,
      role: dto.role,
      status: dto.status,
    });
  }

  public async findById(id: string): Promise<TenantUser> {
    const tenantUser = await this.tenantUserRepository.findById(id);

    if (!tenantUser) {
      throw new NotFoundException(`Tenant user '${id}' was not found.`);
    }

    return tenantUser;
  }

  public async findByTenantId(tenantId: string): Promise<TenantUser[]> {
    return await this.tenantUserRepository.findByTenantId(tenantId);
  }

  public async findByExternalUserId(
    externalUserId: string,
  ): Promise<TenantUser[]> {
    return await this.tenantUserRepository.findByExternalUserId(externalUserId);
  }

  public async update(
    id: string,
    dto: UpdateTenantUserDto,
  ): Promise<TenantUser> {
    const tenantUser = await this.findById(id);

    if (dto.email !== undefined) {
      tenantUser.email = dto.email;
    }

    if (dto.displayName !== undefined) {
      tenantUser.displayName = dto.displayName;
    }

    if (dto.role !== undefined) {
      tenantUser.role = dto.role;
    }

    if (dto.status !== undefined) {
      tenantUser.status = dto.status;
    }

    return await this.tenantUserRepository.update(tenantUser);
  }

  public async delete(id: string): Promise<void> {
    await this.findById(id);

    await this.tenantUserRepository.delete(id);
  }
}
