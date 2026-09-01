import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class SwitchTenantResponseDto {
  @Expose({ name: 'access_token' })
  @ApiProperty({
    name: 'access_token',
    description: 'New tenant-scoped access token',
  })
  public accessToken!: string;

  @Expose({ name: 'refresh_token' })
  @ApiProperty({
    name: 'refresh_token',
    description:
      'Refresh token bound to the new tenant grant. Required so silent renew does not revert to the previous tenant.',
  })
  public refreshToken!: string;

  @Expose({ name: 'token_type' })
  @ApiProperty({ name: 'token_type', example: 'Bearer' })
  public tokenType!: string;

  @Expose({ name: 'expires_in' })
  @ApiProperty({ name: 'expires_in', example: 300 })
  public expiresIn!: number;

  public static from(
    accessToken: string,
    refreshToken: string,
    tokenType: string,
    expiresIn: number,
  ): SwitchTenantResponseDto {
    const dto = new SwitchTenantResponseDto();
    dto.accessToken = accessToken;
    dto.refreshToken = refreshToken;
    dto.tokenType = tokenType;
    dto.expiresIn = expiresIn;
    return dto;
  }
}
