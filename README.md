# Digital Credential Common Service

A multi-tenant API providing a format-agnostic abstraction layer for Digital Credential operations. The service normalizes issue/verify/hold patterns across credential formats and backend agents, enabling seamless integration of diverse credential ecosystems.

## Overview

The Digital Credential Common Service acts as a unified gateway for Digital Credential operations. It abstracts away the complexity of working with multiple credential formats and allows applications to interact with credentials through a standardized API.

### Key Features

- **Multi-tenant Architecture**: Isolated tenant environments with secure data segregation
- **Format-Agnostic Operations**: Support for multiple Digital Credential formats
- **Standardized API**: Consistent interfaces for issue, verify, and hold operations
- **Job Processing**: Asynchronous job queue for long-running operations
- **Graceful Shutdown**: Clean application shutdown with resource cleanup
- **Health Monitoring**: Built-in health check endpoints for service monitoring

## Technology Stack

- **Framework**: [NestJS](https://nestjs.com/) - Progressive Node.js framework
- **Database**: [PostgreSQL](https://www.postgresql.org/) - Relational database
- **ORM**: [TypeORM](https://typeorm.io/) - Data persistence layer
- **Job Queue**: [pg-boss](https://github.com/timgit/pg-boss) - PostgreSQL-backed job queue
- **Language**: TypeScript

## Quick Start

### Prerequisites

- Node.js v22.12.0 or higher
- Docker & Docker Compose (recommended)
- PostgreSQL 18+ (or use Docker)

### Installation & Setup

1. **Clone the repository and install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```

3. **Start the application**
   ```bash
   # With Docker Compose (recommended)
   docker compose up

   # Or locally with npm
   npm run start:dev
   ```

The application will be available at `http://localhost:3000`

### Database Migrations

Migrations run automatically when starting with Docker Compose. For local development:

```bash
npm run build
npm run migrate:up
```

See [DEVELOPER.md](docs/DEVELOPER.md#database-migrations) for detailed migration instructions.

### Integration Test Database Profile

Use Docker Compose's `test` profile for an isolated PostgreSQL-only integration
test database on `localhost:5433`, then run integration tests against it:

```bash
docker compose --profile test up -d db-test migrate-test seed-test
npm run test:integration
docker compose --profile test down -v
```

See [DEVELOPER.md](docs/DEVELOPER.md#testing) for details on this and the
other test tiers (unit/integration/e2e), plus `MockAdapter` and test data
factory usage.

## Documentation

- **[DEVELOPER.md](docs/DEVELOPER.md)** - Detailed setup, running, testing, and troubleshooting guide
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** - System architecture and design decisions
- **[openapi.yaml](docs/openapi.yaml)** - API specification

## Project Structure

```
apps/
  └── digital-trust-common-service/        # Main application
      ├── src/
      │   ├── main.ts           # Entry point
      │   ├── app.module.ts     # Root module
      │   ├── health/           # Health check
      │   ├── tenants/          # Tenant management
      │   ├── tenant-users/     # User management
      │   ├── jobs/             # Job processing
      │   └── shutdown/         # Shutdown coordination
      └── test/                 # E2E tests

libs/
  ├── database/                 # Database setup & migrations
  ├── auth/                     # Authentication & authorization
  ├── pg-boss/                  # Job queue service
  └── common/                   # Common utilities
```

## Development

```bash
# Start development server with hot reload
npm run start:dev

# Run unit tests
npm run test

# Run integration tests
npm run test:integration

# Run tests in watch mode
npm run test:watch

# Run e2e tests
npm run test:e2e

# Lint and format code
npm run lint
npm run format
```

For comprehensive development instructions, see [DEVELOPER.md](docs/DEVELOPER.md).

## API Endpoints

- `GET /health/live` - Service health check

See [openapi.yaml](docs/openapi.yaml) for complete API documentation.

## Support

For issues, questions, or contributions, please refer to:
- [DEVELOPER.md](docs/DEVELOPER.md) - Troubleshooting guide
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - System design documentation

## License

UNLICENSED
