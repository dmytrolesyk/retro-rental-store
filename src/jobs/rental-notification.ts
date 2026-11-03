import type { Rental } from '../rentals/entities/rental.entity';

export interface RentalNotification {
  version: 1;
  status: Rental['status'];
  occurredAt: string;
  bookingExpiresAt: string | null;
  dueAt: string | null;
  cancellationReason: string | null;
  subject: string;
  text: string;
}

/** Pure rendering at enqueue time: later status/profile/template changes cannot rewrite a job. */
export function rentalNotification(
  rental: Pick<Rental, 'rentalId' | 'status' | 'bookingExpiresAt' | 'dueAt' | 'cancellationReason'>,
  occurredAt: Date,
): RentalNotification {
  const bookingExpiresAt = rental.bookingExpiresAt?.toISOString() ?? null;
  const dueAt = rental.dueAt?.toISOString() ?? null;
  const descriptions: Record<Rental['status'], string> = {
    BOOKED: `Гру заброньовано. Заберіть її до ${bookingExpiresAt ?? 'не вказано'}. Оплата під час видачі.`,
    ACTIVE: `Гру видано, оплату доби оренди списано. Поверніть її до ${dueAt ?? 'не вказано'}.`,
    OVERDUE: `Строк оренди минув (${dueAt ?? 'не вказано'}). Будь ласка, поверніть гру.`,
    RETURNED: 'Дякуємо за повернення гри!',
    CANCELLED: `Бронювання скасовано. Причина: ${rental.cancellationReason ?? ''}`,
  };
  return {
    version: 1,
    status: rental.status,
    occurredAt: occurredAt.toISOString(),
    bookingExpiresAt,
    dueAt,
    cancellationReason: rental.cancellationReason,
    subject: `Оренда: ${rental.status} — Retro Games Rental`,
    text: `Оренда №${rental.rentalId}\n${descriptions[rental.status]}\nЧас події: ${occurredAt.toISOString()} (UTC).`,
  };
}
