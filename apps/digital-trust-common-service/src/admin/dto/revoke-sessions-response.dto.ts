import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class RevokeSessionsResponseDto {
  @Expose({ name: 'tenant_user_id' })
  @ApiProperty({
    name: 'tenant_user_id',
    description: 'Identifier of the tenant user whose sessions were revoked',
    example: '8f2b1c4e-9d3a-4f57-b6c1-0e7a52d81b34',
  })
  public tenantUserId!: string;

  @Expose({ name: 'account_id' })
  @ApiProperty({
    name: 'account_id',
    description:
      'Tenant user identifier used as the OIDC account identifier on session records',
    example: '8f2b1c4e-9d3a-4f57-b6c1-0e7a52d81b34',
  })
  public accountId!: string;

  @Expose({ name: 'revoked_record_count' })
  @ApiProperty({
    name: 'revoked_record_count',
    description:
      'Number of OIDC records deleted, including sessions, grants, and every token issued under those grants',
    example: 12,
  })
  public revokedRecordCount!: number;

  public static from(
    tenantUserId: string,
    accountId: string,
    revokedRecordCount: number,
  ): RevokeSessionsResponseDto {
    const dto = new RevokeSessionsResponseDto();
    dto.tenantUserId = tenantUserId;
    dto.accountId = accountId;
    dto.revokedRecordCount = revokedRecordCount;
    return dto;
  }
}
