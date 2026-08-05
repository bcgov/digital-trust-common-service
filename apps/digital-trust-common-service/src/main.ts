import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { configureApp } from './app.config';
import { AppModule } from './app.module';
import { DevSeedService } from './seed/dev-seed.service';
import { SwaggerService } from './swagger/swagger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.enableShutdownHooks();

  configureApp(app);

  SwaggerService.setupSwagger(app, configService);

  if (configService.get<string>('SEED_ON_START') === 'true') {
    await app.get(DevSeedService).run();
  }

  const port = parseInt(configService.get<string>('PORT', '3000'), 10);
  await app.listen(port);
}
void bootstrap();
