import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { stringify } from 'yaml';
import { CatalogController } from '../catalog/catalog.controller';
import { CatalogService } from '../catalog/catalog.service';
import { RentalsController } from '../rentals/rentals.controller';
import { RentalsService } from '../rentals/rentals.service';
import { createApiDocument } from '../openapi';

// Metadata only: real controllers/DTOs, no handlers invoked and no database/network startup.
@Module({
  controllers: [CatalogController, RentalsController],
  providers: [
    { provide: CatalogService, useValue: {} },
    { provide: RentalsService, useValue: {} },
  ],
})
class DocumentationModule {}

async function main() {
  const app = await NestFactory.create(DocumentationModule, { logger: false });
  try {
    const directory = join(process.cwd(), 'openapi');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'openapi.yaml'), stringify(createApiDocument(app)));
    console.log('Exported openapi/openapi.yaml');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
