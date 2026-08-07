export { AuthModule } from './auth.module';
export { CurrentAuth } from './decorators/current-auth.decorator';
export { AuthenticationRequiredException } from './exceptions/authentication-required.exception';
export { JwtAuthExceptionFilter } from './filters/jwt-auth.exception-filter';
export { JwtGuard, ScopeGuard, TenantGuard } from './guards';
export type {
  AuthContext,
  AuthTokenType,
} from './interfaces/auth-context.interface';
export { JwksCacheService } from './services/jwks-cache.service';
export {
  extractBearerToken,
  JwtValidationService,
  normalizeAuthPayload,
  verifyAccessToken,
} from './services/jwt-validation.service';
