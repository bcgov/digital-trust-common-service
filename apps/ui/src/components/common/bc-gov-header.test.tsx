import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { BcGovHeader } from './bc-gov-header';
import i18n from '@/lib/i18n';

describe('BcGovHeader', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('switches between English and French', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BcGovHeader />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Français' }));

    expect(
      await screen.findByRole('button', { name: 'English' }),
    ).toHaveAttribute('lang', 'en');
    expect(document.documentElement.lang).toBe('fr');

    await user.click(screen.getByRole('button', { name: 'English' }));

    expect(
      await screen.findByRole('button', { name: 'Français' }),
    ).toHaveAttribute('lang', 'fr');
    expect(document.documentElement.lang).toBe('en');
  });
});
