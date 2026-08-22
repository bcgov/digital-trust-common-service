export { APP_JWT_BEARER_SCHEME } from './constants/app-jwt-bearer.constants';
export {
  ALL_TENANT_SCOPES,
  isKnownScope,
  LEVEL2_SCOPES,
  LEVEL3_SCOPES,
  OAUTH_CLIENT_ALLOWED_ROLES,
  OIDC_SCOPE_ALLOWLIST,
  PLATFORM_ADMIN_ROLE,
  ROLE_HIERARCHY,
  SCOPE_CATALOG,
  TENANT_SUPERUSER_SCOPE,
} from './constants/scopes.constants';
export type {
  ScopeCatalogEntry,
  TenantRole,
} from './constants/scopes.constants';
export { AuthModule } from './auth.module';
export { CurrentAuth } from './decorators/current-auth.decorator';
export { ApiJwtAuth } from './decorators/api-jwt-auth.decorator';
export { RequireRoles } from './decorators/require-roles.decorator';
export { RequireScopes } from './decorators/require-scopes.decorator';
export { AuthenticationRequiredException } from './exceptions/authentication-required.exception';
export { InsufficientScopeException } from './exceptions/insufficient-scope.exception';
export { TenantAccessDeniedException } from './exceptions/tenant-access-denied.exception';
export { InsufficientScopeExceptionFilter } from './filters/insufficient-scope.exception-filter';
export { JwtAuthExceptionFilter } from './filters/jwt-auth.exception-filter';
export { TenantAccessDeniedExceptionFilter } from './filters/tenant-access-denied.exception-filter';
export { JwtGuard, ScopeGuard, TenantGuard } from './guards';
export type {
  AuthContext,
  AuthTokenType,
} from './interfaces/auth-context.interface';
export {
  JwksCacheService,
  JwksKeyNotFoundError,
} from './services/jwks-cache.service';
export {
  extractBearerToken,
  JwtValidationService,
  normalizeAuthPayload,
  verifyAccessToken,
} from './services/jwt-validation.service';
export { ScopeAuthorizationService } from './services/scope-authorization.service';
