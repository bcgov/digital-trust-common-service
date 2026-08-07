import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { AuthModule } from './auth.module';
import { JwtGuard } from './guards/jwt.guard';
import { ScopeGuard } from './guards/scope.guard';
import { TenantGuard } from './guards/tenant.guard';
import { JwtValidationService } from './services/jwt-validation.service';

describe('AuthModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule],
    }).compile();
  });

  it('should provide JwtGuard', () => {
    expect(module.get<JwtGuard>(JwtGuard)).toBeDefined();
  });

  it('should provide ScopeGuard', () => {
    expect(module.get<ScopeGuard>(ScopeGuard)).toBeDefined();
  });

  it('should provide TenantGuard', () => {
    expect(module.get<TenantGuard>(TenantGuard)).toBeDefined();
  });

  it('should provide JwtValidationService', () => {
    expect(
      module.get<JwtValidationService>(JwtValidationService),
    ).toBeDefined();
  });
});
