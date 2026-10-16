import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// `text-body` and `text-h5` are BCDS font-size utilities declared in
// index.css. tailwind-merge cannot distinguish them from a text colour, so
// without this it silently drops them when they sit next to a `text-*` colour
// class (for example `text-body text-muted-foreground`).
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': ['text-body', 'text-h5'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
