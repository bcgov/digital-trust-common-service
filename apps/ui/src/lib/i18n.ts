import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from '@/locales/en.json';

// Bundled resources and `initAsync: false` make `t` usable as soon as this
// module is imported, including outside React.
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    supportedLngs: ['en'],
    fallbackLng: 'en',
    initAsync: false,
    interpolation: { escapeValue: false },
  });

document.documentElement.lang = i18n.language;
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

export default i18n;
