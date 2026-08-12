import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OidcUpstreamInteraction } from './oidc-upstream-interaction.entity';

@Injectable()
export class OidcUpstreamInteractionRepository {
  public constructor(
    @InjectRepository(OidcUpstreamInteraction)
    private readonly repository: Repository<OidcUpstreamInteraction>,
  ) {}

  public async create(
    interaction: Partial<OidcUpstreamInteraction>,
  ): Promise<OidcUpstreamInteraction> {
    const entity = this.repository.create(interaction);
    return await this.repository.save(entity);
  }

  public async findById(id: string): Promise<OidcUpstreamInteraction | null> {
    return await this.repository.findOne({
      where: { id },
    });
  }
  public async findByInteractionUid(
    uid: string,
  ): Promise<OidcUpstreamInteraction | null> {
    return await this.repository.findOne({
      where: { interactionUid: uid },
    });
  }

  public async findByState(
    state: string,
  ): Promise<OidcUpstreamInteraction | null> {
    return await this.repository.findOne({
      where: { state },
    });
  }

  public async findExpiredInteractions(): Promise<OidcUpstreamInteraction[]> {
    return await this.repository
      .createQueryBuilder('interaction')
      .where('interaction.expiresAt < NOW()')
      .getMany();
  }

  public async findConsumedInteractions(): Promise<OidcUpstreamInteraction[]> {
    return await this.repository
      .createQueryBuilder('interaction')
      .where('interaction.consumedAt IS NOT NULL')
      .getMany();
  }

  public async update(
    interaction: OidcUpstreamInteraction,
  ): Promise<OidcUpstreamInteraction> {
    return await this.repository.save(interaction);
  }

  public async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  public async deleteByState(state: string): Promise<void> {
    await this.repository.delete({ state });
  }
}
