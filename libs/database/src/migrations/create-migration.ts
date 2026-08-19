import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

interface MigrationInfo {
  migrationName: string;
  className: string;
  fullClassName: string;
  fileName: string;
  filePath: string;
  importStatement: string;
}

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  rl.close();
  process.exit(1);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toClassName(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function getNextMigrationNumber(directory: string): number {
  const numbers = fs
    .readdirSync(directory)
    .filter((file) => /^\d{6}_/.test(file))
    .map((file) => Number(file.slice(0, 6)));

  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

function buildMigrationInfo(
  migrationsDir: string,
  migrationName: string,
): MigrationInfo {
  const number = getNextMigrationNumber(migrationsDir);
  const paddedNumber = String(number).padStart(6, '0');
  const className = toClassName(migrationName);
  const fullClassName = `${className}${Date.now()}`;
  const fileName = `${paddedNumber}_${migrationName}.ts`;

  return {
    migrationName,
    className,
    fullClassName,
    fileName,
    filePath: path.join(migrationsDir, fileName),
    importStatement: `import { ${fullClassName} } from './migrations/${fileName.replace('.ts', '')}';\n`,
  };
}

function createMigrationTemplate(info: MigrationInfo): string {
  return `import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = '${info.className}';

export class ${info.fullClassName} implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // TODO: Implement migration up
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // TODO: Implement migration down
  }
}
`;
}

function writeMigrationFile(info: MigrationInfo): void {
  if (fs.existsSync(info.filePath)) {
    fail(`Migration file already exists: ${info.fileName}`);
  }

  fs.writeFileSync(info.filePath, createMigrationTemplate(info));
  process.stdout.write(`✓ Migration created: ${info.fileName}\n`);
}

function addMigrationImport(source: string, importStatement: string): string {
  const migrationImportsMatch = source.match(
    /(import\s+.*from\s+['"]\.\/migrations\/[^'"]*['"];(?:\n|$))+/,
  );

  if (migrationImportsMatch) {
    return source.replace(
      migrationImportsMatch[0],
      migrationImportsMatch[0] + importStatement,
    );
  }

  return source.replace(
    /export const AppDataSource/,
    `${importStatement}\nexport const AppDataSource`,
  );
}

function addMigrationToArray(source: string, migrationClass: string): string {
  return source.replace(/migrations:\s*\[([^\]]*)\]/, (_, current: string) => {
    // The array in data-source.ts is prettier-formatted, so it is multiline
    // and carries a trailing comma. Appending directly to that would emit
    // `[..., Last,, New]`, which is a sparse array (an elision) rather than a
    // syntax error, silently putting `undefined` into `migrations`.
    const migrations = current.trim().replace(/,$/, '').trim();

    return migrations.length
      ? `migrations: [${migrations}, ${migrationClass}]`
      : `migrations: [${migrationClass}]`;
  });
}

function updateDataSource(migrationsDir: string, info: MigrationInfo): void {
  const dataSourcePath = path.join(
    path.dirname(migrationsDir),
    'data-source.ts',
  );

  let content = fs.readFileSync(dataSourcePath, 'utf8');

  content = addMigrationImport(content, info.importStatement);
  content = addMigrationToArray(content, info.fullClassName);

  fs.writeFileSync(dataSourcePath, content);

  process.stdout.write('✓ Updated data-source.ts\n');
}

async function createMigration(): Promise<void> {
  const migrationName = (
    await prompt('Enter migration name (e.g., create-users-table): ')
  ).trim();

  if (!migrationName) {
    fail('Migration name cannot be empty');
  }

  const migrationsDir = __dirname;

  const info = buildMigrationInfo(migrationsDir, migrationName);

  writeMigrationFile(info);

  try {
    updateDataSource(migrationsDir, info);
  } catch (error) {
    process.stderr.write(
      `Warning: Could not update data-source.ts: ${getErrorMessage(error)}\n`,
    );
  }

  rl.close();
}

if (require.main === module) {
  createMigration().catch((error) => {
    process.stderr.write(
      `Error creating migration: ${getErrorMessage(error)}\n`,
    );
    rl.close();
    process.exit(1);
  });
}
