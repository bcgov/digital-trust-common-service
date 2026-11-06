import * as path from 'node:path';

import './jest-integration-setup';

// CI sets this explicitly; locally it keeps `npm run test:log-gateway` a
// single command against the test database stack.
if (!process.env.UPSTREAM_IDENTITY_FEDERATION_CONFIG_PATH?.trim()) {
  process.env.UPSTREAM_IDENTITY_FEDERATION_CONFIG_PATH = path.resolve(
    __dirname,
    '../../../config/upstream-identity-federation.json',
  );
}
