import { AuthClient } from './auth.js';
import { ClientError } from './errors.js';
import { isRecord } from './http.js';

export interface GraphqlReader {
  query(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>>;
}
export class GraphqlClient implements GraphqlReader {
  constructor(private readonly auth = new AuthClient()) {}
  async query(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    return (await this.auth.requestGraphql(query, variables)).data;
  }
}
export function invalidResponse(): never {
  throw new ClientError('API_RESPONSE_INVALID', 'LMS повернула неочікувану структуру даних.', 5);
}
export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) invalidResponse();
  return value;
}
export function nodes(value: unknown): Record<string, unknown>[] {
  const connection = record(value);
  if (!Array.isArray(connection.edges)) invalidResponse();
  return connection.edges.map((edge: unknown) => record(record(edge).node));
}
export function nextCursor(value: unknown): string | null {
  const info = record(record(value).pageInfo);
  if (typeof info.hasNextPage !== 'boolean') invalidResponse();
  if (!info.hasNextPage) return null;
  if (typeof info.endCursor !== 'string' || !info.endCursor) invalidResponse();
  return info.endCursor;
}
export function numericId(value: Record<string, unknown>, resource: string): number {
  const id = value._id;
  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    value.id !== `/api/${resource}/${String(id)}`
  )
    invalidResponse();
  return id;
}
export function nullableString(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') invalidResponse();
  return value;
}
export function ukrainianTranslation(value: unknown): Record<string, unknown> | null {
  const translations = nodes(value);
  for (const node of translations) {
    if (node.locale !== 'uk' || typeof node.empty !== 'boolean') invalidResponse();
    if (!node.empty) return node;
  }
  return null;
}
