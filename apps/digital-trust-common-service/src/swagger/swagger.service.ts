import { APP_JWT_BEARER_SCHEME } from '@app/auth/constants/app-jwt-bearer.constants';
import { INestApplication, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Response } from 'express';

import { AdminModule } from '../admin/admin.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthApiModule } from '../auth/auth-api.module';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { ConnectionModule } from '../connection/connection.module';
import { ConnectorModule } from '../connector/connector.module';
import { CredentialActionModule } from '../credential/credential-action.module';
import { CredentialDefinitionModule } from '../credential-definition/credential-definition.module';
import { OAuthClientModule } from '../oauth-client/oauth-client.module';
import { OperationModule } from '../operation/operation.module';
import { TenantModule } from '../tenant/tenant.module';
import { TenantUserModule } from '../tenant-user/tenant-user.module';
import { WebhookIngestionModule } from '../webhook-ingestion/webhook-ingestion.module';

const FULL_DOC_TITLE = 'Digital Credential Common Service API';

/**
 * Description shared by the full-documentation `DocumentBuilder` instances
 * (UI and JSON-only paths). Kept as a single constant so the two builders
 * cannot drift out of sync. `${API_BASE_PATH}` is interpolated so the stated
 * base path always tracks the API version constants.
 */
const FULL_DOC_DESCRIPTION =
  'A comprehensive API for managing Digital Credential Common Service models. Provides functionality for credential lifecycle management, schema validation, and multi-tenant support. ' +
  `All business routes are served under the versioned base path ${API_BASE_PATH}; the OpenAPI document version below (1.0) is this document's own revision, distinct from the URL version segment.`;

const FULL_DOC_VERSION = '1.0';

function addOidcTokenEndpoint(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.securitySchemes ??= {};
  document.components.securitySchemes.oidcClientBasic = {
    type: 'http',
    scheme: 'basic',
    description:
      'API client ID and secret for the client_credentials grant. Use only on a trusted connection.',
  };
  document.paths['/oidc/token'] = {
    post: {
      tags: ['OIDC'],
      summary: 'Obtain an API client access token',
      description:
        'Authenticate with the API client ID and secret using HTTP Basic authentication. Copy the returned access token into the bearer authorization for API requests.',
      security: [{ oidcClientBasic: [] }],
      requestBody: {
        required: true,
        content: {
          'application/x-www-form-urlencoded': {
            schema: {
              type: 'object',
              required: ['grant_type'],
              properties: {
                grant_type: {
                  type: 'string',
                  enum: ['client_credentials'],
                  default: 'client_credentials',
                },
                scope: {
                  type: 'string',
                  description: 'Space-separated scopes granted to the client.',
                },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Access token issued.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  access_token: { type: 'string' },
                  token_type: { type: 'string' },
                  expires_in: { type: 'integer' },
                  scope: { type: 'string' },
                },
              },
            },
          },
        },
        '400': { description: 'Invalid token request or scope.' },
        '401': { description: 'Invalid client credentials.' },
      },
    },
  };
  return document;
}

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
    modules: [
      ConnectionModule,
      CredentialActionModule,
      ConnectorModule,
      OperationModule,
      WebhookIngestionModule,
    ],
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
  options: {
    includeAppJwtBearerAuth?: boolean;
  } = {},
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
    const config = addAppJwtBearerAuth(
      new DocumentBuilder()
        .setTitle(FULL_DOC_TITLE)
        .setDescription(FULL_DOC_DESCRIPTION)
        .setVersion(FULL_DOC_VERSION)
        .addTag('digital-trust-common-service'),
    ).build();

    const document = addOidcTokenEndpoint(
      SwaggerModule.createDocument(app, config),
    );
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
    const config = addAppJwtBearerAuth(
      new DocumentBuilder()
        .setTitle(FULL_DOC_TITLE)
        .setDescription(FULL_DOC_DESCRIPTION)
        .setVersion(FULL_DOC_VERSION)
        .addTag('digital-trust-common-service'),
    ).build();

    const docToUse =
      document ||
      addOidcTokenEndpoint(SwaggerModule.createDocument(app, config));

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
      includeAppJwtBearerAuth:
        name === 'admin' || name === 'tenant' || name === 'dc',
    });

    const document = addOidcTokenEndpoint(
      SwaggerModule.createDocument(app, config, { include: modules }),
    );

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
      includeAppJwtBearerAuth:
        name === 'admin' || name === 'tenant' || name === 'dc',
    });

    const docToUse =
      document ||
      addOidcTokenEndpoint(
        SwaggerModule.createDocument(app, config, { include: modules }),
      );

    // Expose JSON endpoint
    app
      .getHttpAdapter()
      .get(`/api/docs/${name}/json`, (_req: unknown, res: Response) => {
        res.json(docToUse);
      });
  }
}
