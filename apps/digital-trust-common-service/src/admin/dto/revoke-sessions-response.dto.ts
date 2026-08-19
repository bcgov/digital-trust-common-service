import { ApiProperty } from '@nestjs/swagger';

export class RevokeSessionsResponseDto {
  @ApiProperty({
    description: 'Identifier of the tenant user whose sessions were revoked',
    example: '8f2b1c4e-9d3a-4f57-b6c1-0e7a52d81b34',
  })
  public tenantUserId!: string;

  @ApiProperty({
    description:
      'Tenant user identifier used as the OIDC account identifier on session records',
    example: '8f2b1c4e-9d3a-4f57-b6c1-0e7a52d81b34',
  })
  public accountId!: string;

  @ApiProperty({
    description:
      'Number of OIDC records deleted, including sessions, grants, and every token issued under those grants',
    example: 12,
  })
  public revokedRecordCount!: number;
}
