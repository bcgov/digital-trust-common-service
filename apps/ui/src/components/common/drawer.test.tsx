import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from './drawer.js';

function Example({
  showCloseButton,
  size,
}: {
  showCloseButton?: boolean;
  size?: 'sm' | 'md' | 'lg';
} = {}) {
  return (
    <Drawer direction="right">
      <DrawerTrigger>Open</DrawerTrigger>
      <DrawerContent
        showCloseButton={showCloseButton}
        size={size}
        className="custom-class"
      >
        <DrawerHeader>
          <DrawerTitle>Invite user</DrawerTitle>
          <DrawerDescription>
            They can sign in to this tenant.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>Body content</DrawerBody>
        <DrawerFooter>
          <DrawerClose>Cancel</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

describe('Drawer', () => {
  it('opens from the trigger and labels itself with the title', async () => {
    const user = userEvent.setup();
    render(<Example />);

    expect(screen.queryByText('Invite user')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('Invite user');
    expect(dialog).toHaveAccessibleDescription(
      'They can sign in to this tenant.',
    );
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('closes from the built-in close button', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('closes from a DrawerClose in the footer', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('can omit the close button for a drawer that must be dismissed deliberately', async () => {
    const user = userEvent.setup();
    render(<Example showCloseButton={false} />);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog');

    expect(
      screen.queryByRole('button', { name: 'Close' }),
    ).not.toBeInTheDocument();
  });

  it('applies the size variant width and merges a caller className', async () => {
    const user = userEvent.setup();
    render(<Example size="lg" />);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog');

    expect(dialog).toHaveClass('custom-class');
    expect(dialog).toHaveClass('[--drawer-width:42rem]');
  });

  it('defaults to the medium width when no size is given', async () => {
    const user = userEvent.setup();
    render(<Example />);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog');

    expect(dialog).toHaveClass('[--drawer-width:32rem]');
  });
});
