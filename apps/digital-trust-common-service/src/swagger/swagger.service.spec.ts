import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { Response } from 'express';

/* eslint-disable @typescript-eslint/unbound-method */

// Mock modules before importing the service
jest.mock('@nestjs/swagger', () => {
  const decorator = (): (() => void) => () => undefined;
  const mockDocumentBuilder = {
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setVersion: jest.fn().mockReturnThis(),
    addTag: jest.fn().mockReturnThis(),
    addBearerAuth: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue({
      openapi: '3.0.0',
    }),
  };

  return {
    DocumentBuilder: jest.fn(() => mockDocumentBuilder),
    SwaggerModule: {
      createDocument: jest.fn(),
      setup: jest.fn(),
    },
    ApiProperty: decorator,
    ApiBearerAuth: decorator,
    ApiUnauthorizedResponse: decorator,
    ApiOperation: decorator,
    ApiOkResponse: decorator,
    ApiForbiddenResponse: decorator,
    ApiTags: decorator,
  };
});

// Helper function to create module mocks from module paths
const mockAppModules = (
  modulePaths: string[],
): Record<string, Record<string, jest.Mock>> => {
  const mocks: Record<string, Record<string, jest.Mock>> = {};

  modulePaths.forEach((modulePath) => {
    const fileName = modulePath.split('/').pop() || '';
    const baseName = fileName.replace(/\.module(\.ts)?$/, '');
    const exportName =
      baseName
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('') + 'Module';

    mocks[modulePath] = {
      [exportName]: jest.fn(),
    };
  });

  return mocks;
};

// Mock all app modules
const modulesToMock = [
  '../tenant/tenant.module',
  '../tenant-user/tenant-user.module',
  '../auth/auth-api.module',
  '../credential-definition/credential-definition.module',
  '../connection/connection.module',
  '../oauth-client/oauth-client.module',
  '../connector-credential/connector-credential.module',
  '../operation/operation.module',
  '../audit-log/audit-log.module',
  '../admin/admin.module',
];

const modulesMock = mockAppModules(modulesToMock);

// Apply each mock
Object.entries(modulesMock).forEach(([modulePath, moduleExport]) => {
  jest.mock(modulePath, () => moduleExport);
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SwaggerService } = require('./swagger.service');

describe('SwaggerService', () => {
  let mockGetHttpAdapter: jest.Mock;
  let mockHttpAdapterGet: jest.Mock;
  let mockConfigServiceGet: jest.Mock;
  let mockApp: INestApplication;
  let mockConfigService: ConfigService;

  beforeEach((): void => {
    jest.clearAllMocks();

    mockHttpAdapterGet = jest.fn();
    mockGetHttpAdapter = jest.fn().mockReturnValue({
      get: mockHttpAdapterGet,
    });

    mockConfigServiceGet = jest.fn(
      (key: string, defaultValue: unknown) => defaultValue,
    );

    mockApp = {
      getHttpAdapter: mockGetHttpAdapter,
    } as unknown as INestApplication;

    mockConfigService = {
      get: mockConfigServiceGet,
    } as unknown as ConfigService;

    (SwaggerModule.createDocument as jest.Mock).mockReturnValue({
      openapi: '3.0.0',
      info: { title: 'Test API' },
    });

    (SwaggerModule.setup as jest.Mock).mockReturnValue(undefined);
  });

  describe('setupSwagger', () => {
    it('should setup full documentation when SWAGGER_ENABLED is true (default)', (): void => {
      mockConfigServiceGet.mockImplementation(
        (_key: string, defaultValue: unknown) => defaultValue,
      );

      SwaggerService.setupSwagger(mockApp, mockConfigService);

      expect(SwaggerModule.createDocument).toHaveBeenCalled();
      expect(SwaggerModule.setup).toHaveBeenCalledTimes(4);
      expect(mockHttpAdapterGet).toHaveBeenCalledTimes(4);
    });

    it('should setup full documentation when SWAGGER_ENABLED is explicitly true', (): void => {
      mockConfigServiceGet.mockImplementation((key: string): unknown => {
        if (key === 'SWAGGER_ENABLED') return 'true';
        if (key === 'SWAGGER_JSON_ENABLED') return 'false';
        return undefined;
      });

      SwaggerService.setupSwagger(mockApp, mockConfigService);

      expect(SwaggerModule.createDocument).toHaveBeenCalled();
      expect(SwaggerModule.setup).toHaveBeenCalledTimes(4);
      expect(mockHttpAdapterGet).toHaveBeenCalledTimes(4);
    });

    it('should skip setup when SWAGGER_ENABLED is false and SWAGGER_JSON_ENABLED is not set', (): void => {
      mockConfigServiceGet.mockImplementation((key: string): unknown => {
        if (key === 'SWAGGER_ENABLED') return 'false';
        if (key === 'SWAGGER_JSON_ENABLED') return 'false';
        return undefined;
      });

      SwaggerService.setupSwagger(mockApp, mockConfigService);

      expect(SwaggerModule.createDocument).not.toHaveBeenCalled();
      expect(SwaggerModule.setup).not.toHaveBeenCalled();
      expect(mockHttpAdapterGet).not.toHaveBeenCalled();
    });

    it('should setup only JSON endpoints when SWAGGER_JSON_ENABLED is true and SWAGGER_ENABLED is false', (): void => {
      mockConfigServiceGet.mockImplementation((key: string): unknown => {
        if (key === 'SWAGGER_ENABLED') return 'false';
        if (key === 'SWAGGER_JSON_ENABLED') return 'true';
        return undefined;
      });

      SwaggerService.setupSwagger(mockApp, mockConfigService);

      expect(SwaggerModule.createDocument).toHaveBeenCalled();
      expect(SwaggerModule.setup).not.toHaveBeenCalled();
      expect(mockHttpAdapterGet).toHaveBeenCalledTimes(4);
    });

    it('should setup full documentation when SWAGGER_JSON_ENABLED is true and SWAGGER_ENABLED is true', (): void => {
      mockConfigServiceGet.mockImplementation((key: string): unknown => {
        if (key === 'SWAGGER_ENABLED') return 'true';
        if (key === 'SWAGGER_JSON_ENABLED') return 'true';
        return undefined;
      });

      SwaggerService.setupSwagger(mockApp, mockConfigService);

      expect(SwaggerModule.createDocument).toHaveBeenCalled();
      expect(SwaggerModule.setup).toHaveBeenCalledTimes(4);
      expect(mockHttpAdapterGet).toHaveBeenCalledTimes(4);
    });
  });

  describe('JSON endpoints', () => {
    it('should register /api/docs/json endpoint', (): void => {
      mockConfigServiceGet.mockImplementation(
        (_key: string, defaultValue: unknown) => defaultValue,
      );

      SwaggerService.setupSwagger(mockApp, mockConfigService);

      const calls = mockHttpAdapterGet.mock.calls as Array<
        [string, (...args: unknown[]) => void]
      >;
      const jsonCall = calls.find((call) => call[0] === '/api/docs/json');

      expect(jsonCall).toBeDefined();
    });

    it('should register /api/docs/tenant/json endpoint', (): void => {
      mockConfigServiceGet.mockImplementation(
        (_key: string, defaultValue: unknown) => defaultValue,
      );

      SwaggerService.setupSwagger(mockApp, mockConfigService);

      const calls = mockHttpAdapterGet.mock.calls as Array<
        [string, (...args: unknown[]) => void]
      >;
      const tenantJsonCall = calls.find(
        (call) => call[0] === '/api/docs/tenant/json',
      );

      expect(tenantJsonCall).toBeDefined();
    });

    it('should register /api/docs/admin/json endpoint', (): void => {
      mockConfigServiceGet.mockImplementation(
        (_key: string, defaultValue: unknown) => defaultValue,
      );

      SwaggerService.setupSwagger(mockApp, mockConfigService);

      const calls = mockHttpAdapterGet.mock.calls as Array<
        [string, (...args: unknown[]) => void]
      >;
      const adminJsonCall = calls.find(
        (call) => call[0] === '/api/docs/admin/json',
      );

      expect(adminJsonCall).toBeDefined();
    });

    it('JSON endpoint callback should call res.json with document', (): void => {
      mockConfigServiceGet.mockImplementation(
        (_key: string, defaultValue: unknown) => defaultValue,
      );

      const mockRes = { json: jest.fn() } as unknown as Response;
      const document = { openapi: '3.0.0' };
      (SwaggerModule.createDocument as jest.Mock).mockReturnValue(document);

      SwaggerService.setupSwagger(mockApp, mockConfigService);

      const calls = mockHttpAdapterGet.mock.calls as Array<
        [string, (...args: unknown[]) => void]
      >;
      const jsonCall = calls.find((call) => call[0] === '/api/docs/json');

      expect(jsonCall).toBeDefined();
      if (jsonCall !== undefined) {
        const callback = jsonCall[1];
        callback(null, mockRes);
        expect(mockRes.json).toHaveBeenCalledWith(document);
      }
    });
  });

  describe('environment variable parsing', () => {
    it('should parse SWAGGER_ENABLED as boolean', (): void => {
      mockConfigServiceGet.mockImplementation(
        (key: string, defaultValue: unknown): unknown => {
          if (key === 'SWAGGER_ENABLED') return true;
          return defaultValue;
        },
      );

      SwaggerService.setupSwagger(mockApp, mockConfigService);

      expect(mockConfigServiceGet).toHaveBeenCalledWith(
        'SWAGGER_ENABLED',
        'true',
      );
    });

    it('should parse SWAGGER_JSON_ENABLED as boolean with true default', (): void => {
      mockConfigServiceGet.mockImplementation(
        (key: string, defaultValue: unknown): unknown => {
          if (key === 'SWAGGER_JSON_ENABLED') return false;
          return defaultValue;
        },
      );

      SwaggerService.setupSwagger(mockApp, mockConfigService);

      expect(mockConfigServiceGet).toHaveBeenCalledWith(
        'SWAGGER_JSON_ENABLED',
        'true',
      );
    });
  });
});
