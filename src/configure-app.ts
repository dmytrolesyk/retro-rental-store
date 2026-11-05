import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ProblemFilter } from './common/problem.filter';
import { HTTP_VALIDATION_OPTIONS } from './common/validation.options';
import { setupSwagger } from './openapi';

export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(new ValidationPipe(HTTP_VALIDATION_OPTIONS));
  app.useGlobalFilters(new ProblemFilter());
  setupSwagger(app);
}
