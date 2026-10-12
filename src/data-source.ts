import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { createDataSourceOptions } from './database/data-source-options';

// Importing this module does not connect, start Nest or change the schema.
export default new DataSource(createDataSourceOptions());
