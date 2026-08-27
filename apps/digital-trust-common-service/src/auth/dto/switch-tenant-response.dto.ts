import { ApiProperty } from '@nestjs/swagger';

export class SwitchTenantResponseDto {
  @ApiProperty({ description: 'New tenant-scoped access token' })
  public access_token!: string;

  @ApiProperty({
    description:
      'Refresh token bound to the new tenant grant. Required so silent renew does not revert to the previous tenant.',
  })
  public refresh_token!: string;

  @ApiProperty({ example: 'Bearer' })
  public token_type!: string;

  @ApiProperty({ example: 300 })
  public expires_in!: number;
}
