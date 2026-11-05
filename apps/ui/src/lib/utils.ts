import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// BCDS font-size and spacing utilities declared in index.css. tailwind-merge cannot
// distinguish them from a text colour, so without this it silently drops them
// when they sit next to a `text-*` colour class (for example
// `text-body text-muted-foreground`).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: [
        'hair',
        'xsmall',
        'small',
        'medium',
        'large',
        'xlarge',
        'xxlarge',
        'xxxlarge',
        'huge',
      ],
    },
    classGroups: {
      'font-size': [
        'text-body',
        'text-h1',
        'text-h2',
        'text-h3',
        'text-h4',
        'text-h5',
        'text-small-body',
        'text-label',
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
