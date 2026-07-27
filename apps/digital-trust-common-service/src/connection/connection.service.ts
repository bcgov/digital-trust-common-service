import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Connection, ConnectionState } from './connection.entity';
import { ConnectionRepository } from './connection.repository';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';

@Injectable()
export class ConnectionService {
  public constructor(
    private readonly connectionRepository: ConnectionRepository,
  ) {}

  public async create(dto: CreateConnectionDto): Promise<Connection> {
    const existing = await this.connectionRepository.findByExternalConnectionId(
      dto.externalConnectionId,
    );

    if (existing) {
      throw new ConflictException(
        'Connection with this external ID already exists.',
      );
    }

    return await this.connectionRepository.create({
      tenantId: dto.tenantId,
      externalConnectionId: dto.externalConnectionId,
      theirLabel: dto.theirLabel,
      theirDid: dto.theirDid,
      state: dto.state,
      connectorType: dto.connectorType,
      protocol: dto.protocol,
      metadata: dto.metadata || {},
    });
  }

  public async findById(id: string): Promise<Connection> {
    const connection = await this.connectionRepository.findById(id);

    if (!connection) {
      throw new NotFoundException(`Connection '${id}' was not found.`);
    }

    return connection;
  }

  public async findByExternalConnectionId(
    externalConnectionId: string,
  ): Promise<Connection> {
    const connection =
      await this.connectionRepository.findByExternalConnectionId(
        externalConnectionId,
      );

    if (!connection) {
      throw new NotFoundException(
        `Connection with external ID '${externalConnectionId}' was not found.`,
      );
    }

    return connection;
  }

  public async findByTenantId(tenantId: string): Promise<Connection[]> {
    return await this.connectionRepository.findByTenantId(tenantId);
  }

  public async findByTenantIdAndState(
    tenantId: string,
    state: ConnectionState,
  ): Promise<Connection[]> {
    return await this.connectionRepository.findByTenantIdAndState(
      tenantId,
      state,
    );
  }

  public async update(
    id: string,
    dto: UpdateConnectionDto,
  ): Promise<Connection> {
    const connection = await this.findById(id);

    if (dto.theirLabel !== undefined) {
      connection.theirLabel = dto.theirLabel;
    }

    if (dto.theirDid !== undefined) {
      connection.theirDid = dto.theirDid;
    }

    if (dto.state !== undefined) {
      connection.state = dto.state;
    }

    if (dto.protocol !== undefined) {
      connection.protocol = dto.protocol;
    }

    if (dto.metadata !== undefined) {
      connection.metadata = dto.metadata;
    }

    return await this.connectionRepository.update(connection);
  }

  public async delete(id: string): Promise<void> {
    await this.findById(id);

    await this.connectionRepository.delete(id);
  }
}
