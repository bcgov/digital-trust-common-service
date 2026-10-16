import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

function renderEmpty(props: React.ComponentProps<typeof Empty> = {}) {
  return render(
    <Empty {...props}>
      <EmptyHeader>
        <EmptyMedia>
          <svg data-testid="empty-glyph" />
        </EmptyMedia>
        <EmptyTitle>No tenants yet</EmptyTitle>
        <EmptyDescription>
          Tenants you create will be listed here.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>Create tenant</Button>
      </EmptyContent>
    </Empty>,
  );
}

describe('Empty', () => {
  it('renders the title, description and primary action', () => {
    renderEmpty();

    expect(screen.getByText('No tenants yet')).toBeInTheDocument();
    expect(
      screen.getByText('Tenants you create will be listed here.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create tenant' }),
    ).toBeInTheDocument();
  });

  it('hides the media from assistive technology', () => {
    // The glyph repeats the title, so it is decorative rather than content.
    renderEmpty();

    const media = screen.getByTestId('empty-glyph').parentElement;
    expect(media).toHaveAttribute('aria-hidden', 'true');
    expect(media).toHaveAttribute('data-slot', 'empty-icon');
  });

  it('is bounded rather than filling its container', () => {
    const { container } = renderEmpty();

    const empty = container.querySelector('[data-slot="empty"]');
    // Regression guard: the stock component is `w-full flex-1`, which
    // stretches across the page instead of hugging its content.
    expect(empty).toHaveClass('[--empty-width:23.75rem]');
    expect(empty).toHaveClass('max-w-[var(--empty-width)]');
    expect(empty).not.toHaveClass('flex-1');
  });

  it('draws no surface of its own', () => {
    const { container } = renderEmpty();

    // The design sits flat on the page: no box, fill or padding. The stock
    // component asks for `border-dashed` without a border width, which
    // paints nothing — easy to "fix" into a border that isn't in the design.
    const empty = container.querySelector('[data-slot="empty"]');
    expect(empty?.className).not.toMatch(/\b(border|bg-|p-|rounded)/);
  });

  it('takes a wider size variant and merges a caller className', () => {
    const { container } = renderEmpty({ size: 'lg', className: 'mt-8' });

    const empty = container.querySelector('[data-slot="empty"]');
    expect(empty).toHaveClass('[--empty-width:28rem]', 'mt-8');
    expect(empty).not.toHaveClass('[--empty-width:23.75rem]');
  });

  it('renders the description as a paragraph', () => {
    renderEmpty();

    expect(
      screen.getByText('Tenants you create will be listed here.').tagName,
    ).toBe('P');
  });

  it('applies the BCDS type scale to the title and description', () => {
    renderEmpty();

    // `text-body` looks like a colour utility to tailwind-merge, so it is
    // dropped next to `text-muted-foreground` unless `cn` knows better.
    expect(screen.getByText('No tenants yet')).toHaveClass('text-h5');
    expect(
      screen.getByText('Tenants you create will be listed here.'),
    ).toHaveClass('text-body', 'text-muted-foreground');
  });
});
