import { ApiProperty } from '@nestjs/swagger';

import { OAuthClientResponseDto } from './oauth-client-response.dto';

export class CreateOAuthClientResponseDto {
  @ApiProperty({
    description: 'The created OAuth client',
    type: OAuthClientResponseDto,
  })
  public client!: OAuthClientResponseDto;

  @ApiProperty({
    description:
      'The client secret (only returned on creation, never shown again)',
    example: 'secret-xyz-123',
  })
  public clientSecret!: string;
}
