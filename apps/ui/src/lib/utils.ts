import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// BCDS font-size utilities declared in index.css. tailwind-merge cannot
// distinguish them from a text colour, so without this it silently drops them
// when they sit next to a `text-*` colour class (for example
// `text-body text-muted-foreground`).
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        'text-body',
        'text-h1',
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
