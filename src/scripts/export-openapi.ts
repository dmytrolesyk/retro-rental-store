import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthModule } from '../auth/auth.module';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { stringify } from 'yaml';
import { CatalogController } from '../catalog/catalog.controller';
import { CatalogService } from '../catalog/catalog.service';
import { RentalsController } from '../rentals/rentals.controller';
import { RentalsService } from '../rentals/rentals.service';
import { IssueRental } from '../rentals/use-cases/issue-rental';
import { CancelRental } from '../rentals/use-cases/cancel-rental';
import { ReturnRental } from '../rentals/use-cases/return-rental';
import { createApiDocument } from '../openapi';

// Metadata only: real controllers/DTOs, no handlers invoked and no database/network startup.
@Module({
  imports: [AuthModule],
  controllers: [CatalogController, RentalsController],
  providers: [
    { provide: CatalogService, useValue: {} },
    { provide: RentalsService, useValue: {} },
    { provide: IssueRental, useValue: {} },
    { provide: CancelRental, useValue: {} },
    { provide: ReturnRental, useValue: {} },
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
