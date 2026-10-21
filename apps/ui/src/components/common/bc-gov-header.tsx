import { Header } from '@bcgov/design-system-react-components';
import { Link } from 'react-router';

import { APP_NAME } from '@/lib/constants';

/**
 * App boundary around the official BCDS `<Header>` — the one place that
 * absorbs prop/class churn from the pre-1.0 package (BCDS-first is the
 * standing direction; shadcn fills the gaps it doesn't cover).
 *
 * Integration notes for the package:
 * its bundle style-injects the CSS for every BCDS component at import time,
 * AFTER our stylesheet in production builds — any app override of a
 * `.bcds-*` class must therefore out-specify the package rule, never rely
 * on source order (see the header override in index.css). It also injects
 * its own inlined copy of the design tokens, which is why the @bcgov
 * package versions are exact-pinned and lockstep-checked by
 * src/test/design-system.test.ts.
 */
export function BcGovHeader({
  titleAs = 'span',
  logoTo = '/',
  children,
}: {
  /** 'h1' where the header doubles as the page heading (e.g. login). */
  titleAs?: 'span' | 'h1';
  /** Router target for the logo link. */
  logoTo?: string;
  children?: React.ReactNode;
}) {
  return (
    <Header
      title={APP_NAME}
      titleElement={titleAs}
      logoLinkElement={
        <Link to={logoTo} title="Government of British Columbia" />
      }
      skipLinks={[
        <a key="main-content" href="#main-content">
          Skip to main content
        </a>,
      ]}
    >
      {children}
    </Header>
  );
}
