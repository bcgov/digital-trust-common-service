import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConnectionController } from './connection.controller';
import { Connection } from './connection.entity';
import { ConnectionRepository } from './connection.repository';
import { ConnectionService } from './connection.service';

@Module({
  imports: [TypeOrmModule.forFeature([Connection])],
  controllers: [ConnectionController],
  providers: [ConnectionService, ConnectionRepository],
  exports: [ConnectionService],
})
export class ConnectionModule {}
