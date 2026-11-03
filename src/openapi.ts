import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function createApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Retro Games Rental API')
    .setDescription(
      'Catalog and single-copy booking/rental API. Monetary amounts are integer kopecks. Rental operations require configured opaque Bearer credentials; the game catalog is public.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'opaque',
      description: 'Configured opaque token (not a JWT).',
    })
    .addServer('http://localhost:3000', 'Local server; override the URL for your deployment.')
    .addTag('games', 'Game catalog and supported platforms.')
    .addTag(
      'rentals',
      'Reserve for 24 hours; staff issues for one paid day, accepts returns, or cancels bookings.',
    )
    .build();
  const document = SwaggerModule.createDocument(app, { ...config, security: [] });
  // Swagger cannot infer the global ValidationPipe's forbidNonWhitelisted policy.
  for (const name of ['CreateRentalDto', 'CancelRentalDto']) {
    const input = document.components?.schemas?.[name];
    if (input && !('$ref' in input)) input.additionalProperties = false;
  }
  return document;
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, () => createApiDocument(app));
}
