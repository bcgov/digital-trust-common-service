import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { instanceToPlain } from 'class-transformer';

import { CredentialDefinitionFormat } from '../../credential-definition/credential-definition.entity';
import { PresentationDefinition } from '../presentation-definition.entity';

import { ListPresentationDefinitionsQueryDto } from './list-verification-profiles-query.dto';
import {
  CreatePresentationDefinitionDto,
  PresentationDefinitionResponseDto,
  UpdatePresentationDefinitionDto,
} from './presentation-definition.dto';

describe('Presentation resource DTOs', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const definition = {
    name: 'identity',
    version: '1.0',
    query: {
      type: 'dif-presentation-exchange',
      presentation_definition: {
        id: 'identity',
        input_descriptors: [{ id: 'person' }],
      },
    },
    options: { format: 'anoncreds' },
  };
  const transformDefinition = (value: unknown) =>
    pipe.transform(value, {
      type: 'body',
      metatype: CreatePresentationDefinitionDto,
    });
  it('transforms nested snake-case definition fields', async () => {
    const dto = await transformDefinition(definition);
    expect(dto.query.presentationDefinition.id).toBe('identity');
  });

  it.each([
    { query: { requested_attributes: {} } },
    { query: { ...definition.query, type: 'dcql' } },
    { query: { ...definition.query, type: 'QueryByExample' } },
    { query: { ...definition.query, native: {} } },
    { query: null },
    { query: [definition.query] },
    { options: null },
    { options: [definition.options] },
    { options: { format: 'sd_jwt_vc' } },
    { options: { format: 'anoncreds', non_revoked: { max_age_seconds: 10 } } },
    { nonce: '123' },
  ])('rejects unsupported query/options or client nonce: %j', async (patch) => {
    await expect(
      transformDefinition({ ...definition, ...patch }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects null draft query/options rather than silently ignoring them', async () => {
    for (const body of [{ query: null }, { options: null }]) {
      await expect(
        pipe.transform(body, {
          type: 'body',
          metatype: UpdatePresentationDefinitionDto,
        }),
      ).rejects.toThrow(BadRequestException);
    }
  });

  it('rejects the profile-only public filter on definition lists', async () => {
    await expect(
      pipe.transform(
        { public: 'true' },
        { type: 'query', metatype: ListPresentationDefinitionsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('serializes definition query fields without leaking legacy storage shape', () => {
    const response = PresentationDefinitionResponseDto.fromEntity({
      id: '123e4567-e89b-12d3-a456-426614174003',
      presentationDefinition: definition.query.presentation_definition,
      presentationFormat: CredentialDefinitionFormat.ANONCREDS,
      predicates: null,
    } as PresentationDefinition);
    const plain = instanceToPlain(response);
    expect(plain.query).toEqual({
      type: 'dif-presentation-exchange',
      presentation_definition: definition.query.presentation_definition,
      predicates: null,
    });
    expect(plain.options).toEqual({ format: 'anoncreds' });
    expect(plain).not.toHaveProperty('presentationDefinition');
  });
});
