import path from 'path';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import { envSchema } from '../dist/config/env.schema.js';

async function parseEnvFile() {
  const __dirname = import.meta.dirname;
  const file = await fs.open(path.join(__dirname, '../.env.example'), 'r');
  const envExampleFileBuf = await fs.readFile(file);
  const envObject = dotenv.parse(envExampleFileBuf);
  return envObject;
}

async function main() {
  const envObj = await parseEnvFile();

  const missingKeys = Object.keys(envSchema.shape).filter(
    (key) => !(key in envObj),
  );
  if (missingKeys.length > 0) {
    throw new Error(
      `.env.example is missing schema variables: ${missingKeys.join(', ')}`,
    );
  }

  const parsed = envSchema.safeParse(envObj);
  if (!parsed.success) {
    const lines = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid .env.example: \n${lines}`);
  }
  console.log('.env.example is valid');
}

main();
