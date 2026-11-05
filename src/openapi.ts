import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function createApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Retro Games Rental API')
    .setDescription(
      'Catalog and single-copy rental API. Monetary amounts are integer kopecks. No authentication is configured yet.',
    )
    .setVersion('1.0.0')
    .addServer('http://localhost:3000', 'Local server; override the URL for your deployment.')
    .addTag('games', 'Game catalog and supported platforms.')
    .addTag('rentals', 'Single-copy rentals, one day per checkout.')
    .build();
  const document = SwaggerModule.createDocument(app, { ...config, security: [] });
  // Swagger cannot infer the global ValidationPipe's forbidNonWhitelisted policy.
  const input = document.components?.schemas?.CreateRentalDto;
  if (input && !('$ref' in input)) input.additionalProperties = false;
  return document;
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, () => createApiDocument(app));
}
