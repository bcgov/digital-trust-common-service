import { ApiProperty } from '@nestjs/swagger';

export class RevokeSessionsResponseDto {
  @ApiProperty({
    description: 'Identifier of the tenant user whose sessions were revoked',
    example: '8f2b1c4e-9d3a-4f57-b6c1-0e7a52d81b34',
  })
  public tenantUserId!: string;

  @ApiProperty({
    description:
      'External identity provider subject used as the OIDC account identifier',
    example: 'b1f5a0c2-7e4d-4a91-8c33-2d6f9ab4e017',
  })
  public accountId!: string;

  @ApiProperty({
    description:
      'Number of OIDC records deleted, including sessions, grants, and every token issued under those grants',
    example: 12,
  })
  public revokedRecordCount!: number;
}
