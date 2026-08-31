import { OidcMountService } from '@app/oidc';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { configureApp } from './app.config';
import { AppModule } from './app.module';
import { DevSeedService } from './seed/dev-seed.service';
import { shouldRunDevSeedOnStart } from './seed/seed-on-start.util';
import { SwaggerService } from './swagger/swagger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.enableShutdownHooks();

  configureApp(app);

  OidcMountService.mount(app);

  SwaggerService.setupSwagger(app, configService);

  if (shouldRunDevSeedOnStart(configService)) {
    await app.init();
    await app.get(DevSeedService).run();
  }

  const port = parseInt(configService.get<string>('PORT', '3000'), 10);
  await app.listen(port);
}
void bootstrap();
