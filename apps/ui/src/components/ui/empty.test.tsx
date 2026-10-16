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
    expect(empty).toHaveClass('[--empty-width:19rem]');
    expect(empty).toHaveClass('max-w-[var(--empty-width)]');
    expect(empty).not.toHaveClass('flex-1');
  });

  it('paints a solid border, not the stock dashed-but-widthless one', () => {
    const { container } = renderEmpty();

    const empty = container.querySelector('[data-slot="empty"]');
    expect(empty).toHaveClass('border', 'border-border', 'bg-card');
    expect(empty).not.toHaveClass('border-dashed');
  });

  it('takes a wider size variant and merges a caller className', () => {
    const { container } = renderEmpty({ size: 'lg', className: 'mt-8' });

    const empty = container.querySelector('[data-slot="empty"]');
    expect(empty).toHaveClass('[--empty-width:28rem]', 'mt-8');
    expect(empty).not.toHaveClass('[--empty-width:19rem]');
  });

  it('renders the description as a paragraph', () => {
    renderEmpty();

    expect(
      screen.getByText('Tenants you create will be listed here.').tagName,
    ).toBe('P');
  });
});
