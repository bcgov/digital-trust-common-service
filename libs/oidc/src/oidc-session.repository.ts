import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OidcModel } from './entities/oidc-model.entity';

type OidcInteractionSessionPayload = {
  uid?: string;
  session?: {
    uid?: string;
  };
};

@Injectable()
export class OidcSessionRepository {
  private static readonly INTERACTION_MODEL_NAME = 'Interaction';
  private static readonly SESSION_MODEL_NAME = 'Session';

  public constructor(
    @InjectRepository(OidcModel)
    private readonly repository: Repository<OidcModel>,
  ) {}

  public async findInteractionByUid(uid: string): Promise<OidcModel | null> {
    return await this.repository.findOne({
      where: {
        modelName: OidcSessionRepository.INTERACTION_MODEL_NAME,
        oidcId: uid,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  public async findSessionByUid(uid: string): Promise<OidcModel | null> {
    return await this.repository.findOne({
      where: {
        modelName: OidcSessionRepository.SESSION_MODEL_NAME,
        uid,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  public getSessionUidFromInteraction(
    interaction: Pick<OidcModel, 'payload' | 'uid'>,
  ): string | null {
    const payload = interaction.payload as OidcInteractionSessionPayload;

    if (typeof interaction.uid === 'string' && interaction.uid.length > 0) {
      return interaction.uid;
    }

    if (typeof payload.uid === 'string' && payload.uid.length > 0) {
      return payload.uid;
    }

    return typeof payload.session?.uid === 'string'
      ? payload.session.uid
      : null;
  }
}
