import { BadRequestException } from '@nestjs/common';

import {
  assertClaimsSchemaUsable,
  validateClaims,
  validateProfileClaims,
} from './claims-schema';

describe('profile claim schemas', () => {
  it('accepts nested claims and reports nested paths as segments', () => {
    const namespace = 'org.iso.18013.5.1';
    const schema = {
      type: 'object',
      properties: {
        [namespace]: {
          type: 'object',
          properties: {
            family_name: { type: 'string' },
            driving_privileges: {
              type: 'array',
              items: {
                type: 'object',
                properties: { vehicle_category_code: { type: 'string' } },
                required: ['vehicle_category_code'],
                additionalProperties: false,
              },
            },
          },
          required: ['family_name'],
          additionalProperties: false,
        },
      },
      required: [namespace],
      additionalProperties: false,
    };

    validateClaims(
      schema,
      {},
      {
        [namespace]: {
          family_name: 'Smith',
          driving_privileges: [{ vehicle_category_code: 'A' }],
        },
      },
    );

    try {
      validateClaims(schema, {}, { [namespace]: {} });
      throw new Error('Expected claims validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        message: 'Claims failed validation',
        details: [
          {
            path: [namespace, 'family_name'],
            message: "must have required property 'family_name'",
          },
        ],
      });
    }
  });

  it('reports the required nickname as a path array, not a JSON Pointer', () => {
    try {
      validateClaims(
        {
          type: 'object',
          properties: { nickname: { type: 'string' } },
        },
        { required: ['nickname'] },
        {},
      );
      throw new Error('Expected claims validation to fail');
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        details: [{ path: ['nickname'] }],
      });
    }
  });

  it('reports nested array indexes as numeric path segments', () => {
    try {
      validateClaims(
        {
          type: 'object',
          properties: {
            vehicles: {
              type: 'array',
              items: {
                type: 'object',
                properties: { category: { type: 'string' } },
              },
            },
          },
        },
        {},
        { vehicles: [{ category: 5 }] },
      );
      throw new Error('Expected claims validation to fail');
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        details: [{ path: ['vehicles', 0, 'category'] }],
      });
    }
  });

  it('allows only rules that tighten definition enum and const constraints', () => {
    const schema = {
      type: 'object',
      properties: {
        licence_class: { type: 'string', enum: ['5', '7', 'L'] },
        province: { type: 'string' },
      },
    };
    validateProfileClaims(schema, {
      properties: {
        licence_class: { enum: ['5', '7'] },
        province: { const: 'BC' },
      },
    });

    expect(() =>
      validateProfileClaims(schema, {
        properties: { licence_class: { enum: ['5', '9'] } },
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      validateProfileClaims(schema, {
        properties: { unknown: { const: 'value' } },
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      validateProfileClaims(schema, {
        properties: { province: { default: 'BC' } },
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects remote JSON Schema references', () => {
    expect(() =>
      validateClaims(
        {
          type: 'object',
          properties: { name: { $ref: 'https://schemas.example/name' } },
        },
        {},
        { name: 'Alice' },
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects deeply nested claims before invoking Ajv', () => {
    const claims: Record<string, unknown> = {};
    let current = claims;
    for (let index = 0; index < 33; index += 1) {
      const child: Record<string, unknown> = {};
      current.nested = child;
      current = child;
    }

    try {
      validateClaims({ type: 'object' }, {}, claims);
      throw new Error('Expected deeply nested claims to fail validation');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        message: 'Claims failed validation',
        details: [{ path: Array.from({ length: 33 }, () => 'nested') }],
      });
    }
  });

  it('rejects deeply nested definition schemas before compiling them', () => {
    let schema: Record<string, unknown> = { type: 'string' };
    for (let index = 0; index < 33; index += 1) {
      schema = { type: 'object', properties: { nested: schema } };
    }

    expect(() => validateClaims(schema, {}, {})).toThrow(BadRequestException);
  });

  it('reports only the property that breaks compilation when others use local refs', () => {
    expect(() =>
      assertClaimsSchemaUsable({
        type: 'object',
        properties: {
          name: { type: 'string' },
          alias: { $ref: '#/properties/name' },
          age: { type: 'string', 'x-label': 'Age' },
        },
      }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          details: [
            {
              path: ['properties', 'age'],
              message: expect.stringContaining('x-label') as string,
            },
          ],
        }) as object,
      }) as Error,
    );
  });

  it('does not unregister shared schemas while diagnosing a rejected schema', () => {
    expect(() =>
      assertClaimsSchemaUsable({
        type: 'object',
        properties: {
          meta: { $id: 'http://json-schema.org/draft-07/schema#' },
        },
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      validateProfileClaims(
        { type: 'object', properties: { fresh: { type: 'number' } } },
        {},
      ),
    ).not.toThrow();
  });
});
