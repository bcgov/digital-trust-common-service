import { Callout } from '@bcgov/design-system-react-components';
import type { ReactNode } from 'react';

/**
 * Clear messaging for a route or section the caller's role/scope cannot use.
 *
 * Deliberately not `role="alert"`: a caller without the required scope is
 * the expected outcome of normal navigation (readonly viewing a tenant,
 * a URL for a tenant the token isn't bound to), not a failure that should
 * interrupt assistive tech the way an unexpected error does.
 *
 * Uses the Callout's children slot because its `title` renders a `span`,
 * and pages rely on this title being a real heading.
 */
export function AccessDenied({
  title,
  description,
  headingLevel,
}: {
  title: string;
  description: ReactNode;
  headingLevel: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';

  return (
    <div className="max-w-lg">
      <Callout>
        <div className="bcds-Callout--Container">
          <Heading className="bcds-Callout--Title">{title}</Heading>
          <div className="bcds-Callout--Description">{description}</div>
        </div>
      </Callout>
    </div>
  );
}
