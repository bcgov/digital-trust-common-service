import { BadRequestException } from '@nestjs/common';

import { PresentationDefinitionQueryDto } from './dto/presentation-definition.dto';
import { VerificationPredicateCondition } from './dto/verification-predicate.dto';
import { assertSupportedPresentationQuery } from './presentation-query.validator';

describe('Supported presentation definition query', () => {
  const query = (): PresentationDefinitionQueryDto => ({
    type: 'dif-presentation-exchange',
    presentationDefinition: {
      id: 'identity',
      input_descriptors: [
        {
          id: 'person',
          constraints: { fields: [{ path: ['$.credentialSubject.name'] }] },
        },
      ],
    },
  });

  it('accepts existing attribute selection and numeric predicate representation', () => {
    expect(() =>
      assertSupportedPresentationQuery({
        ...query(),
        predicates: [
          {
            attribute: 'age',
            condition: VerificationPredicateCondition.GREATER_THAN_OR_EQUAL,
            value: '19',
          },
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    { submission_requirements: [{ rule: 'pick' }] },
    { non_revoked: { to: 100 } },
    { id: '' },
    { input_descriptors: [] },
    {
      input_descriptors: [
        { id: 'x', group: ['a'], constraints: { fields: [] } },
      ],
    },
    {
      input_descriptors: [
        { id: 'x', constraints: { limit_disclosure: 'required', fields: [] } },
      ],
    },
    { input_descriptors: [{ id: 'x', constraints: { fields: [] } }] },
    {
      input_descriptors: [
        {
          id: 'x',
          constraints: {
            fields: [
              { path: ['$.credentialSubject.name'], filter: { const: 'a' } },
            ],
          },
        },
      ],
    },
    {
      input_descriptors: [
        {
          id: 'x',
          constraints: {
            fields: [
              { path: ['$.credentialSubject.name', '$.credentialSubject.age'] },
            ],
          },
        },
      ],
    },
    {
      input_descriptors: [
        {
          id: 'x',
          constraints: { fields: [{ path: ['$.credentialSubject.*'] }] },
        },
      ],
    },
    { input_descriptors: [{ id: 'x', constraints: null }] },
  ])('rejects unrepresentable or malformed constraints: %j', (patch) => {
    const input = query();
    Object.assign(input.presentationDefinition, patch);
    expect(() => assertSupportedPresentationQuery(input)).toThrow(
      BadRequestException,
    );
  });

  it.each(['', 'abc', '1.2', '2147483648', '-2147483649'])(
    'rejects invalid predicate threshold %j',
    (value) => {
      expect(() =>
        assertSupportedPresentationQuery({
          ...query(),
          predicates: [
            {
              attribute: 'age',
              condition: VerificationPredicateCondition.GREATER_THAN,
              value,
            },
          ],
        }),
      ).toThrow(BadRequestException);
    },
  );
});
