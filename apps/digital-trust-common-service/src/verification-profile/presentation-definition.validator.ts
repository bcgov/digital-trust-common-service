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

    const fields = descriptor.constraints?.fields;

    if (!Array.isArray(fields)) {
      continue;
    }

    for (const field of fields) {
      const paths = (field as { path?: unknown } | undefined)?.path;

      if (!Array.isArray(paths)) {
        continue;
      }

      for (const path of paths) {
        if (typeof path !== 'string') {
          continue;
        }

        const segments = path
          .split(/[.[\]]/)
          .filter((segment) => segment.length > 0);
        const lastSegment = segments[segments.length - 1];

        if (lastSegment) {
          names.add(stripJsonPathQuotes(lastSegment));
        }
      }
    }
  }

  return [...names];
}
