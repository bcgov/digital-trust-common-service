import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { ArrowLeftIcon } from '@/components/common/icons';

export function BackLink({
  to,
  children,
  isDisabled = false,
}: {
  to: string;
  children: ReactNode;
  isDisabled?: boolean;
}) {
  const content = (
    <>
      <ArrowLeftIcon className="size-4" />
      {children}
    </>
  );
  const className =
    'inline-flex w-fit items-center gap-2 text-small-body text-(--typography-color-link)';

  if (isDisabled) {
    return (
      <span
        role="link"
        aria-disabled="true"
        className={`${className} opacity-50`}
      >
        {content}
      </span>
    );
  }

  return (
    <Link to={to} className={`${className} hover:underline`}>
      {content}
    </Link>
  );
}
