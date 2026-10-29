import i18n, { type BackendModule } from 'i18next';
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

// English is bundled and `initAsync: false` makes `t` usable as soon as this
// module is imported, including outside React.
void i18n
  .use(loadCatalog)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    partialBundledLanguages: true,
    supportedLngs: ['en', 'fr'],
    fallbackLng: 'en',
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
