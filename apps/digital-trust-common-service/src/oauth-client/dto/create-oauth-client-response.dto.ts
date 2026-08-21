import { ApiProperty } from '@nestjs/swagger';

import { OAuthClientResponseDto } from './oauth-client-response.dto';

export class CreateOAuthClientResponseDto {
  @ApiProperty({
    description: 'The OAuth client',
    type: OAuthClientResponseDto,
  })
  public client!: OAuthClientResponseDto;

  @ApiProperty({
    description:
      'The client secret (returned only on create and rotate-secret; never shown again)',
    example: 'secret-xyz-123',
  })
  public clientSecret!: string;
}
