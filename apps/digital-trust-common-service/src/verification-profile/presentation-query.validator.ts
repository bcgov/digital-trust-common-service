import { BadRequestException } from '@nestjs/common';

import { PresentationDefinitionQueryDto } from './dto/presentation-definition.dto';
import { extractRequestedAttributes } from './presentation-definition.validator';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Presentation query must contain objects.');
  }
  return value as Record<string, unknown>;
}

function supportedKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new BadRequestException('Unsupported presentation query constraint.');
  }
}

export function assertSupportedPresentationQuery(
  query: PresentationDefinitionQueryDto,
): void {
  const definition = query.presentationDefinition;
  extractRequestedAttributes(definition);
  if (typeof definition.id !== 'string' || !definition.id.trim()) {
    throw new BadRequestException(
      'Presentation definition id must not be empty.',
    );
  }
  supportedKeys(definition, ['id', 'name', 'purpose', 'input_descriptors']);
  const descriptors = definition.input_descriptors as unknown[];
  for (const value of descriptors) {
    const descriptor = object(value);
    supportedKeys(descriptor, ['id', 'name', 'purpose', 'constraints']);
    const constraints = object(descriptor.constraints);
    supportedKeys(constraints, ['fields']);
    if (!Array.isArray(constraints.fields) || constraints.fields.length === 0) {
      throw new BadRequestException('Each descriptor must select attributes.');
    }
    for (const value of constraints.fields) {
      const field = object(value);
      supportedKeys(field, ['path']);
      if (
        !Array.isArray(field.path) ||
        field.path.length !== 1 ||
        typeof field.path[0] !== 'string' ||
        !/^\$\.credentialSubject\.[A-Za-z_][A-Za-z0-9_]*$/.test(field.path[0])
      ) {
        throw new BadRequestException(
          'Each field must select one $.credentialSubject.attribute path.',
        );
      }
    }
  }
  for (const predicate of query.predicates ?? []) {
    const threshold = Number(predicate.value);
    if (
      !['<', '<=', '>', '>='].includes(predicate.condition) ||
      !predicate.value.trim() ||
      !Number.isInteger(threshold) ||
      threshold < -2147483648 ||
      threshold > 2147483647
    ) {
      throw new BadRequestException('Unsupported AnonCreds predicate.');
    }
  }
}
