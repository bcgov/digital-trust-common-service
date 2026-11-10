import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
} from '@bcgov/design-system-react-components';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from './drawer.js';

function Example({
  showCloseButton,
  size,
  dismissible,
  children,
}: {
  showCloseButton?: boolean;
  size?: 'sm' | 'md' | 'lg';
  dismissible?: boolean;
  children?: ReactNode;
} = {}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onPress={() => setOpen(true)}>Open</Button>
      <Drawer open={open} onOpenChange={setOpen} dismissible={dismissible}>
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
          <DrawerBody>
            Body content
            {children}
          </DrawerBody>
          <DrawerFooter>
            <Button variant="secondary" onPress={() => setOpen(false)}>
              Cancel
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}

async function open(element: ReactNode = <Example />) {
  const user = userEvent.setup();
  render(element);
  await user.click(screen.getByRole('button', { name: 'Open' }));
  const dialog = await screen.findByRole('dialog');
  return { user, dialog };
}

describe('Drawer', () => {
  it('opens and labels itself with the title and description', async () => {
    const { dialog } = await open();

    expect(dialog).toHaveAccessibleName('Invite user');
    expect(dialog).toHaveAccessibleDescription(
      'They can sign in to this tenant.',
    );
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('closes from the built-in close button', async () => {
    const { user } = await open();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('closes from a button in the footer', async () => {
    const { user } = await open();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const { user } = await open();

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus(),
    );
  });

  it('ignores Escape while it is not dismissible', async () => {
    const { user } = await open(<Example dismissible={false} />);

    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('disables the close button while it is not dismissible', async () => {
    const { user } = await open(<Example dismissible={false} />);

    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toBeDisabled();

    await user.click(close);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('can omit the close button for a drawer that must be dismissed deliberately', async () => {
    await open(<Example showCloseButton={false} />);

    expect(
      screen.queryByRole('button', { name: 'Close' }),
    ).not.toBeInTheDocument();
  });

  it('applies the size variant width and merges a caller className', async () => {
    const { dialog } = await open(<Example size="lg" />);

    expect(dialog).toHaveClass('custom-class');
    expect(dialog.closest('.drawer-panel')).toHaveClass(
      '[--drawer-width:42rem]',
    );
  });

  it('defaults to the medium width when no size is given', async () => {
    const { dialog } = await open();

    expect(dialog.closest('.drawer-panel')).toHaveClass(
      '[--drawer-width:32rem]',
    );
  });

  it('keeps a BCDS menu inside it usable, and Escape closes only the menu', async () => {
    const onAction = vi.fn();
    const { user, dialog } = await open(
      <Example>
        <MenuTrigger>
          <Button variant="secondary">Pick</Button>
          <Menu onAction={onAction}>
            <MenuItem id="one" label="One" />
          </Menu>
        </MenuTrigger>
      </Example>,
    );

    await user.click(screen.getByRole('button', { name: 'Pick' }));
    await user.click(await screen.findByRole('menuitem', { name: 'One' }));
    expect(onAction).toHaveBeenCalledWith('one');

    await user.click(screen.getByRole('button', { name: 'Pick' }));
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
    expect(dialog).toBeInTheDocument();
  });

  it('rejects a drawer nested inside another drawer', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <Drawer open>
          <DrawerContent>
            <Drawer open>
              <DrawerContent>Inner</DrawerContent>
            </Drawer>
          </DrawerContent>
        </Drawer>,
      ),
    ).toThrow(/cannot be nested/);
  });
});
