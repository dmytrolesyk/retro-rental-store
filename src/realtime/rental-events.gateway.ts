import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { OnGatewayInit } from '@nestjs/websockets';
import type { Subscription } from 'rxjs';
import { ConfiguredTokenService } from '../auth/configured-token.service';
import { RentalsService } from '../rentals/rentals.service';
import { RentalEventsService } from './rental-events.service';
import { rentalJoinSchema, rentalRoom } from './rental-socket.contract';
import type {
  RentalJoinAck,
  RentalJoinError,
  RentalSocket,
  RentalSocketServer,
} from './rental-socket.contract';

const rejected = (code: RentalJoinError): RentalJoinAck => ({ ok: false, error: { code } });

/** Live room delivery on the API HTTP server. Replay remains a separate transport concern. */
@WebSocketGateway()
export class RentalEventsGateway implements OnGatewayInit<RentalSocketServer>, OnModuleDestroy {
  private readonly logger = new Logger(RentalEventsGateway.name);
  private subscription?: Subscription;

  constructor(
    private readonly tokens: ConfiguredTokenService,
    private readonly rentals: RentalsService,
    private readonly events: RentalEventsService,
  ) {}

  afterInit(server: RentalSocketServer): void {
    server.use((socket, next) => {
      try {
        const token: unknown = socket.handshake.auth.token;
        socket.data.principal = this.tokens.authenticate(token);
        next();
      } catch {
        // Never reflect credentials or authentication internals to clients/logs.
        next(Object.assign(new Error('Unauthorized'), { data: { code: 'UNAUTHORIZED' } }));
      }
    });
    this.subscription = this.events.events$.subscribe(event => {
      server.to(rentalRoom(event.rentalId)).emit('rental.status', event);
    });
  }

  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() socket: RentalSocket,
    @MessageBody() input: unknown,
  ): Promise<RentalJoinAck> {
    try {
      const principal = socket.data.principal;
      if (!principal) return rejected('UNAUTHORIZED');
      const parsed = rentalJoinSchema.safeParse(input);
      if (!parsed.success) return rejected('INVALID_JOIN');
      const { rentalId } = parsed.data;
      const isConnected = (): boolean => socket.connected;
      // Reuse the existing existence/owner/staff read policy; never trust payload identity.
      await this.rentals.get(rentalId, principal);
      if (!isConnected()) return rejected('DISCONNECTED');
      const room = rentalRoom(rentalId);
      await socket.join(room);
      if (!isConnected()) {
        // Covers adapters whose asynchronous join finishes after disconnect cleanup.
        await socket.leave(room);
        return rejected('DISCONNECTED');
      }
      // Nest's Socket.IO adapter sends this value through the client's acknowledgement.
      return { ok: true, rentalId };
    } catch (error) {
      if (error instanceof ForbiddenException) return rejected('FORBIDDEN');
      if (error instanceof NotFoundException) return rejected('RENTAL_NOT_FOUND');
      this.logger.error('Rental room join failed');
      return rejected('INTERNAL_ERROR');
    }
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }
}
