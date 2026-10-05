import { BadRequestException } from '@nestjs/common';

/**
 * Structural validation and attribute extraction for a DIF Presentation
 * Exchange `presentation_definition` object. Shared by
 * `VerificationProfileService` (profile create/update) and
 * `PresentationRequestService` (raw-mode `presentation_definition`), since
 * both accept the same object shape and must reject the same malformed
 * input the same way.
 */

/**
 * Strips a matching pair of surrounding single or double quotes from a
 * JSONPath bracket segment, e.g. `'given_names'` -> `given_names`, so
 * quoted bracket notation (`$['credentialSubject']['given_names']`)
 * resolves to the same attribute name as dot notation.
 */
export function stripJsonPathQuotes(segment: string): string {
  if (
    segment.length >= 2 &&
    ((segment.startsWith("'") && segment.endsWith("'")) ||
      (segment.startsWith('"') && segment.endsWith('"')))
  ) {
    return segment.slice(1, -1);
  }

  return segment;
}

/**
 * True when `descriptor` is a DIF Presentation Exchange input_descriptor
 * with the required string `id` field.
 */
export function hasValidDescriptorId(
  descriptor: unknown,
): descriptor is { id: string; constraints?: { fields?: unknown } } {
  return (
    !!descriptor &&
    typeof descriptor === 'object' &&
    typeof (descriptor as { id?: unknown }).id === 'string'
  );
}

/**
 * Resolves a single DIF Presentation Exchange JSONPath (e.g.
 * `$.credentialSubject.given_names` or
 * `$['credentialSubject']['given_names']`) to the attribute name it
 * references, i.e. the path's last segment with any surrounding quotes
 * stripped. Returns `undefined` for a path with no segments.
 */
function attributeNameFromPath(path: string): string | undefined {
  const segments = path.split(/[.[\]]/).filter((segment) => segment.length > 0);
  const lastSegment = segments[segments.length - 1];

  return lastSegment ? stripJsonPathQuotes(lastSegment) : undefined;
}

/**
 * Resolves the attribute names referenced by a single
 * `constraints.fields[]` entry's `path` JSONPath array. Non-string paths
 * and a missing/malformed `path` array yield no names.
 */
function attributeNamesFromField(field: unknown): string[] {
  const paths = (field as { path?: unknown } | undefined)?.path;

  if (!Array.isArray(paths)) {
    return [];
  }

  return paths
    .filter((path): path is string => typeof path === 'string')
    .map(attributeNameFromPath)
    .filter((name): name is string => name !== undefined);
}

/**
 * Resolves the attribute names referenced by a single input descriptor's
 * `constraints.fields[].path` entries. A descriptor with no fields
 * references no attributes.
 */
function attributeNamesFromDescriptor(descriptor: {
  constraints?: { fields?: unknown };
}): string[] {
  const fields = descriptor.constraints?.fields;

  return Array.isArray(fields) ? fields.flatMap(attributeNamesFromField) : [];
}

/**
 * Extracts attribute names referenced by a DIF Presentation Exchange
 * `presentation_definition`, from each input descriptor's
 * `constraints.fields[].path` JSONPath entries (e.g.
 * `$.credentialSubject.given_names` -> `given_names`). Throws
 * BadRequestException when `presentation_definition` is not a DIF
 * Presentation Exchange object with a non-empty `input_descriptors` array,
 * or when any descriptor is missing its string `id`.
 */
export function extractRequestedAttributes(
  presentationDefinition: Record<string, unknown>,
): string[] {
  const inputDescriptors = presentationDefinition.input_descriptors;

  if (!Array.isArray(inputDescriptors) || inputDescriptors.length === 0) {
    throw new BadRequestException(
      'presentation_definition must be a DIF Presentation Exchange object with a non-empty input_descriptors array.',
    );
  }

  const names = new Set<string>();

  for (const descriptor of inputDescriptors) {
    if (!hasValidDescriptorId(descriptor)) {
      throw new BadRequestException(
        "Each presentation_definition input_descriptor must declare a string 'id'.",
      );
    }

    for (const name of attributeNamesFromDescriptor(descriptor)) {
      names.add(name);
    }
  }

  return [...names];
}
