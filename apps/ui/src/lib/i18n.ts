import i18n, { type BackendModule, type PostProcessorModule } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from '@/locales/en.json';

// Other languages are fetched the first time they are used, so English
// readers never download them.
const loadCatalog: BackendModule = {
  type: 'backend',
  init: () => {},
  read: (language, _namespace, callback) => {
    import(`../locales/${language}.json`).then(
      (catalog: { default: typeof en }) => callback(null, catalog.default),
      (error: Error) => callback(error, false),
    );
  },
};

const ACCENTED: Record<string, string> = {
  a: 'á',
  c: 'ç',
  e: 'é',
  i: 'í',
  n: 'ñ',
  o: 'ó',
  u: 'ú',
  A: 'Á',
  C: 'Ç',
  E: 'É',
  I: 'Í',
  N: 'Ñ',
  O: 'Ó',
  U: 'Ú',
};

// Development only, with `?pseudo` in the URL: accents every translated
// string and pads it by a third, so text that skipped the catalog stands out
// as plain English and layouts can be checked against longer languages.
const pseudoLocale: PostProcessorModule = {
  type: 'postProcessor',
  name: 'pseudo',
  process: (value: string) =>
    `[${value.replace(/[aceinouACEINOU]/g, (letter) => ACCENTED[letter])} ${'~'.repeat(Math.ceil(value.length / 3))}]`,
};
const pseudo =
  import.meta.env.DEV && new URLSearchParams(location.search).has('pseudo');

// English is bundled and `initAsync: false` makes `t` usable as soon as this
// module is imported, including outside React.
void i18n
  .use(loadCatalog)
  .use(pseudoLocale)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    partialBundledLanguages: true,
    supportedLngs: ['en', 'fr'],
    fallbackLng: 'en',
    postProcess: pseudo ? ['pseudo'] : false,
    // Match on the language alone, so a browser preferring en-CA over fr
    // gets English rather than the first exact match further down its list.
    detection: {
      convertDetectedLanguage: (language) => language.split('-')[0],
    },
    initAsync: false,
    interpolation: { escapeValue: false },
  });

document.documentElement.lang = i18n.language;
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

export default i18n;
