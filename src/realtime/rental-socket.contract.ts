import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import type { Principal } from '../auth/principal';
import type { RentalStatusChanged } from '../rentals/rental-status-event';

export const rentalJoinSchema = z
  .object({
    rentalId: z.uuid().transform(value => value.toLowerCase()),
  })
  .strict();

export type RentalJoinError =
  | 'INVALID_JOIN'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RENTAL_NOT_FOUND'
  | 'DISCONNECTED'
  | 'INTERNAL_ERROR';
export type RentalJoinAck =
  | Readonly<{ ok: true; rentalId: string }>
  | Readonly<{ ok: false; error: Readonly<{ code: RentalJoinError }> }>;

export interface RentalClientEvents {
  join: (input: unknown, ack: (result: RentalJoinAck) => void) => void;
}
export interface RentalServerEvents {
  'rental.status': (event: RentalStatusChanged) => void;
}
interface RentalSocketData {
  principal?: Principal;
}
type InterServerEvents = Record<string, never>;
export type RentalSocket = Socket<
  RentalClientEvents,
  RentalServerEvents,
  InterServerEvents,
  RentalSocketData
>;
export type RentalSocketServer = Server<
  RentalClientEvents,
  RentalServerEvents,
  InterServerEvents,
  RentalSocketData
>;

export function rentalRoom(rentalId: string): string {
  return `rentals:${rentalId}`;
}
