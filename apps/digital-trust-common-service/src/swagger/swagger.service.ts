import { APP_JWT_BEARER_SCHEME } from '@app/auth/constants/app-jwt-bearer.constants';
import { INestApplication, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Response } from 'express';

import { AdminModule } from '../admin/admin.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthApiModule } from '../auth/auth-api.module';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { ConnectionModule } from '../connection/connection.module';
import { ConnectorCredentialModule } from '../connector-credential/connector-credential.module';
import { CredentialDefinitionModule } from '../credential-definition/credential-definition.module';
import { OAuthClientModule } from '../oauth-client/oauth-client.module';
import { OperationModule } from '../operation/operation.module';
import { TenantModule } from '../tenant/tenant.module';
import { TenantUserModule } from '../tenant-user/tenant-user.module';

const FULL_DOC_TITLE = 'Digital Credential Common Service API';

/**
 * Description shared by the full-documentation `DocumentBuilder` instances
 * (UI and JSON-only paths). Kept as a single constant so the two builders
 * cannot drift out of sync. `${API_BASE_PATH}` is interpolated so the stated
 * base path always tracks the AG-01 version constants.
 */
const FULL_DOC_DESCRIPTION =
  'A comprehensive API for managing Digital Credential Common Service models. Provides functionality for credential lifecycle management, schema validation, and multi-tenant support. ' +
  `All business routes are served under the versioned base path ${API_BASE_PATH} (see AG-01); the OpenAPI document version below (1.0) is this document's own revision, distinct from the URL version segment.`;

const FULL_DOC_VERSION = '1.0';

const swaggerApps = [
  {
    name: 'tenant',
    title: 'Tenant API',
    description: 'API endpoints for tenant and tenant user management',
    version: '1.0',
    modules: [
      TenantModule,
      TenantUserModule,
      AuthApiModule,
      CredentialDefinitionModule,
      AuditLogModule,
      OAuthClientModule,
    ],
  },
  {
    name: 'dc',
    title: 'Digital Credential Operations API',
    description: 'API endpoints for Digital Credential operations',
    version: '1.0',
    modules: [ConnectionModule, ConnectorCredentialModule, OperationModule],
  },
  {
    name: 'admin',
    title: 'Platform Administration API',
    description:
      'Cross-tenant platform administration endpoints for platform operators and internal tooling',
    version: '1.0',
    modules: [AdminModule],
  },
];

function addAppJwtBearerAuth(configBuilder: DocumentBuilder): DocumentBuilder {
  return configBuilder.addBearerAuth(
    {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description:
        'App-issued access token from POST /oidc/token (client_credentials or user login)',
    },
    APP_JWT_BEARER_SCHEME,
  );
}

function buildDocumentConfig(
  title: string,
  description: string,
  version: string,
  options: { includeAppJwtBearerAuth?: boolean } = {},
): ReturnType<DocumentBuilder['build']> {
  let configBuilder = new DocumentBuilder()
    .setTitle(title)
    .setDescription(description)
    .setVersion(version);

  if (options.includeAppJwtBearerAuth) {
    configBuilder = addAppJwtBearerAuth(configBuilder);
  }

  return configBuilder.build();
}

export class SwaggerService {
  /**
   * Setup Swagger documentation for the application
   */
  public static setupSwagger(
    app: INestApplication,
    configService: ConfigService,
  ): void {
    const swaggerEnabled: boolean =
      configService.get<string>('SWAGGER_ENABLED', 'true') === 'true';
    const swaggerJsonEnabled: boolean =
      configService.get<string>('SWAGGER_JSON_ENABLED', 'true') === 'true';

    // If JSON-only mode is enabled, setup only JSON endpoints
    if (swaggerJsonEnabled && !swaggerEnabled) {
      this.setupJsonEndpoints(app);
      return;
    }

    // If Swagger is disabled and JSON-only is not enabled, skip setup
    if (!swaggerEnabled) {
      return;
    }

    // Full setup: UI + JSON endpoints
    this.setupFullDocumentation(app);
    for (const swaggerApp of swaggerApps) {
      this.setupCustomDocumentation(
        app,
        swaggerApp.name,
        swaggerApp.title,
        swaggerApp.description,
        swaggerApp.version,
        swaggerApp.modules,
      );
    }
  }

  /**
   * Setup only the JSON endpoints for both full and tenant documentation
   */
  private static setupJsonEndpoints(app: INestApplication): void {
    this.setupFullDocumentationJson(app);
    for (const swaggerApp of swaggerApps) {
      this.setupCustomDocumentationJson(
        app,
        swaggerApp.name,
        swaggerApp.title,
        swaggerApp.description,
        swaggerApp.version,
        swaggerApp.modules,
      );
    }
  }

  /**
   * Setup the full API documentation
   */
  private static setupFullDocumentation(app: INestApplication): void {
    const config = new DocumentBuilder()
      .setTitle(FULL_DOC_TITLE)
      .setDescription(FULL_DOC_DESCRIPTION)
      .setVersion(FULL_DOC_VERSION)
      .addTag('digital-trust-common-service')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);

    this.setupFullDocumentationJson(app, document);
  }

  /**
   * Setup the full API documentation JSON endpoint
   */
  private static setupFullDocumentationJson(
    app: INestApplication,
    document?: ReturnType<typeof SwaggerModule.createDocument>,
  ): void {
    const config = new DocumentBuilder()
      .setTitle(FULL_DOC_TITLE)
      .setDescription(FULL_DOC_DESCRIPTION)
      .setVersion(FULL_DOC_VERSION)
      .addTag('digital-trust-common-service')
      .build();

    const docToUse = document || SwaggerModule.createDocument(app, config);

    // Expose JSON endpoint
    app
      .getHttpAdapter()
      .get('/api/docs/json', (_req: unknown, res: Response) => {
        res.json(docToUse);
      });
  }

  /**
   * Setup the tenant-specific API documentation
   */
  private static setupCustomDocumentation(
    app: INestApplication,
    name: string,
    title: string,
    description: string,
    version: string,
    modules: Array<Type<unknown>> = [TenantModule, TenantUserModule],
  ): void {
    const config = buildDocumentConfig(title, description, version, {
      includeAppJwtBearerAuth: name === 'admin' || name === 'tenant',
    });

    const document = SwaggerModule.createDocument(app, config, {
      include: modules,
    });

    SwaggerModule.setup(`api/docs/${name}`, app, document);

    this.setupCustomDocumentationJson(
      app,
      name,
      title,
      description,
      version,
      modules,
      document,
    );
  }

  /**
   * Setup the tenant-specific API documentation JSON endpoint
   */
  private static setupCustomDocumentationJson(
    app: INestApplication,
    name: string,
    title: string,
    description: string,
    version: string,
    modules: Array<Type<unknown>> = [TenantModule, TenantUserModule],
    document?: ReturnType<typeof SwaggerModule.createDocument>,
  ): void {
    const config = buildDocumentConfig(title, description, version, {
      includeAppJwtBearerAuth: name === 'admin' || name === 'tenant',
    });

    const docToUse =
      document ||
      SwaggerModule.createDocument(app, config, {
        include: modules,
      });

    // Expose JSON endpoint
    app
      .getHttpAdapter()
      .get(`/api/docs/${name}/json`, (_req: unknown, res: Response) => {
        res.json(docToUse);
      });
  }
}
