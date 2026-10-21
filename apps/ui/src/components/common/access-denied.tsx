import type { ReactNode } from 'react';

import { Card, CardDescription, CardHeader } from '@/components/common/card';

/**
 * Clear messaging for a route or section the caller's role/scope cannot use.
 *
 * Deliberately not `role="alert"`: a caller without the required scope is
 * the expected outcome of normal navigation (readonly viewing a tenant,
 * a URL for a tenant the token isn't bound to), not a failure that should
 * interrupt assistive tech the way an unexpected error does.
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
    <Card className="max-w-lg">
      <CardHeader>
        <Heading className="font-heading text-base leading-snug font-medium">
          {title}
        </Heading>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
