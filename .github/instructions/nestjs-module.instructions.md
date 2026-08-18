---
applyTo: 'apps/**/src/**/*.ts,libs/**/src/**/*.ts'
description: Feature module layout, layering, DTO validation, Swagger, and versioning conventions.
---

# NestJS module conventions

Use `apps/digital-trust-common-service/src/tenant/` as the reference implementation.

## Folder layout

One flat, singular, kebab-case folder per feature. Files are named `<feature>.<role>.ts` with specs
co-located:

```
tenant/
  tenant.module.ts
  tenant.controller.ts        tenant.controller.spec.ts
  tenant.service.ts           tenant.service.spec.ts
  tenant.repository.ts
  tenant.entity.ts
  dto/create-tenant.dto.ts
  dto/update-tenant.dto.ts
```

Supporting pieces stay in the same folder: `*.worker.ts` for pg-boss workers, `*.interceptor.ts`,
`*.decorator.ts`. See `audit-log/` for a feature that uses all of them.

## Layering

- **Controller** — thin. Delegates to the service, no repository access, no business logic.
- **Service** — business rules, throws Nest HTTP exceptions (`NotFoundException`,
  `ConflictException`, …), emits domain audit events.
- **Repository** — `@Injectable()` class wrapping `@InjectRepository(Entity) private readonly repo:
  Repository<T>`. Not a TypeORM custom repository.
- **Module** — `TypeOrmModule.forFeature([Entity])`, `providers: [Service, Repository]`,
  `exports: [Service]`.

Every tenant-scoped repository exposes a `findByTenant`/`findByTenantId` style method and filters on
`where: { tenantId }`. Never expose a query that can cross tenants.

## Controllers and versioning

```ts
@ApiTags('tenants')
@Controller({ path: 'tenants', version: API_VERSION })
```

`API_VERSION` comes from `common/constants/api-version.constants.ts`. There is no `defaultVersion`,
so a controller that omits `version` is silently served unversioned. Never hardcode `/api/v1`.

## DTOs and validation

class-validator + class-transformer only — no zod. The global `ValidationPipe` in `app.config.ts`
uses `whitelist`, `forbidNonWhitelisted`, and `transform`, so any property not declared on the DTO
produces a 400.

- Required fields use definite assignment (`public name!: string`), optional ones use `?` with
  `@IsOptional()`.
- Route params validate through pipes, e.g. `@Param('id', ParseUUIDPipe)`.
- Derive update DTOs with `PartialType` from `@nestjs/mapped-types`.

## Swagger

- Entities double as response schemas: `@ApiProperty({ description, example })` on every field.
- Controllers declare typed responses — `@ApiOkResponse({ type })`, `@ApiCreatedResponse({ type })`,
  `@ApiNotFoundResponse()`, `@ApiForbiddenResponse()` — and `@ApiBody({ type, examples })` with a
  named example on write endpoints.
- Protected controllers add `@ApiJwtAuth()` from `@app/auth`.
- `swagger/swagger.service.ts` builds several documents; a new tag may need registering there.

## Logging and errors

- `private readonly logger = new Logger(MyClass.name);` — `console` is a lint error.
- Application code throws Nest HTTP exceptions. Connector and adapter code uses the `AdapterError`
  family from `@app/credential-ports` (`ConnectorUnavailableError`, `ValidationError`,
  `TimeoutError`, `FormatNotSupportedError`); transient errors retry with backoff, then dead-letter.
- Auth failures use the exceptions and filters in `libs/auth/src`, not bare `UnauthorizedException`.

## Wiring

Global pipes, interceptors, filters, prefixes, and versioning go in `app.config.ts` so that e2e and
integration tests exercise the same routing as production. `main.ts` only bootstraps.
