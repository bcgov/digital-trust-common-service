import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OAuthClientController } from './oauth-client.controller';
import { OAuthClient } from './oauth-client.entity';
import { OAuthClientRepository } from './oauth-client.repository';
import { OAuthClientService } from './oauth-client.service';

@Module({
  imports: [TypeOrmModule.forFeature([OAuthClient])],
  controllers: [OAuthClientController],
  providers: [OAuthClientService, OAuthClientRepository],
  exports: [OAuthClientService],
})
export class OAuthClientModule {}
