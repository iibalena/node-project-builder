import { NestFactory } from '@nestjs/core';
import { RunnerModule } from './runner.module';

async function bootstrap() {
  const app = await NestFactory.create(RunnerModule);

  const port = Number(process.env.RUNNER_PORT ?? 3001);

  await app.listen(port);
  console.log(`Runner running on port ${port}`);
}
bootstrap();
