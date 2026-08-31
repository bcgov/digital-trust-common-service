import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import { OAuthClient } from '../oauth-client.entity';

import { OAuthClientResponseDto } from './oauth-client-response.dto';

export class CreateOAuthClientResponseDto {
  @ApiProperty({
    description: 'The OAuth client',
    type: OAuthClientResponseDto,
  })
  public client!: OAuthClientResponseDto;

  @Expose({ name: 'client_secret' })
  @ApiProperty({
    name: 'client_secret',
    description:
      'The client secret (returned only on create and rotate-secret; never shown again)',
    example: 'secret-xyz-123',
  })
  public clientSecret!: string;

  public static from(
    client: OAuthClient,
    clientSecret: string,
  ): CreateOAuthClientResponseDto {
    const dto = new CreateOAuthClientResponseDto();
    dto.client = OAuthClientResponseDto.fromEntity(client);
    dto.clientSecret = clientSecret;
    return dto;
  }
}
