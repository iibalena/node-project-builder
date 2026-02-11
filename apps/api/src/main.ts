import { NestFactory } from '@nestjs/core';
import { ApiModule } from './api.module';

async function bootstrap() {
  const app = await NestFactory.create(ApiModule, {
    rawBody: true,
  });

  const port = Number(process.env.API_PORT ?? 3000);

  await app.listen(port);
  console.log(`API running on port ${port}`);

}
bootstrap();
