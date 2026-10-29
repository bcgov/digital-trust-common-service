import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { instanceToPlain } from 'class-transformer';

import { CredentialDefinitionFormat } from '../../credential-definition/credential-definition.entity';
import { CreatePresentationRequestDto } from '../../presentation-request/dto/create-presentation-request.dto';
import { VerificationProfile } from '../verification-profile.entity';

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
  const request = {
    presentation_definition_id: '123e4567-e89b-12d3-a456-426614174003',
    delivery: { connection_id: '123e4567-e89b-12d3-a456-426614174002' },
  };
  const transformDefinition = (value: unknown) =>
    pipe.transform(value, {
      type: 'body',
      metatype: CreatePresentationDefinitionDto,
    });
  const transformRequest = (value: unknown) =>
    pipe.transform(value, {
      type: 'body',
      metatype: CreatePresentationRequestDto,
    });

  it('transforms nested snake-case definition and delivery fields', async () => {
    const dto = await transformDefinition(definition);
    expect(dto.query.presentationDefinition.id).toBe('identity');
    const execution = await transformRequest(request);
    expect(execution.presentationDefinitionId).toBe(
      request.presentation_definition_id,
    );
    expect(execution.delivery.connectionId).toBe(
      request.delivery.connection_id,
    );
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

  it.each([
    { presentation_definition_id: 'not-a-uuid' },
    { delivery: {} },
    { delivery: null },
    { delivery: [request.delivery] },
    { delivery: { connection_id: 'not-a-uuid' } },
    { delivery: { ...request.delivery, nonce: '123' } },
    { verification_profile_id: request.presentation_definition_id },
    { nonce: '123' },
  ])('rejects malformed or undeclared execution input: %j', async (patch) => {
    await expect(transformRequest({ ...request, ...patch })).rejects.toThrow(
      BadRequestException,
    );
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

  it('serializes definition query fields without leaking legacy storage shape', () => {
    const response = PresentationDefinitionResponseDto.fromEntity({
      id: request.presentation_definition_id,
      presentationDefinition: definition.query.presentation_definition,
      presentationFormat: CredentialDefinitionFormat.ANONCREDS,
      predicates: null,
    } as VerificationProfile);
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
