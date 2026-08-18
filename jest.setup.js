// Make Node.js crypto available globally for tests
// Some dependencies may expect crypto to be available without explicit import
const crypto = require('crypto');

if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = crypto.webcrypto;
}

Object.assign(globalThis, {
  crypto,
});
