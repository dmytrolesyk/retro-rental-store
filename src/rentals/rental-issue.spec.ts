import { InvalidRentalIssueError, prepareIssueTerms } from './rental-issue';

describe('Rental issue terms', () => {
  const now = new Date('2026-11-03T10:00:00.000Z');
  const rental = { bookingExpiresAt: new Date('2026-11-04T10:00:00.000Z') };

  it('charges the sum of booked prices and starts exactly 24 hours at physical issue', () => {
    const terms = prepareIssueTerms(rental, [{ costPerDay: 2500 }, { costPerDay: 1700 }], now);
    expect(terms).toEqual({
      amount: 4200,
      rentedAt: new Date('2026-11-03T10:00:00.000Z'),
      dueAt: new Date('2026-11-04T10:00:00.000Z'),
    });
  });

  it('allows a zero-price rental', () => {
    expect(prepareIssueTerms(rental, [{ costPerDay: 0 }], now).amount).toBe(0);
  });

  it('allows issue one millisecond before booking expiry', () => {
    const lastMoment = new Date(rental.bookingExpiresAt.getTime() - 1);
    expect(prepareIssueTerms(rental, [{ costPerDay: 2500 }], lastMoment).rentedAt).toEqual(
      lastMoment,
    );
  });

  it.each([
    ['at expiry', new Date('2026-11-04T10:00:00.000Z')],
    ['after expiry', new Date('2026-11-04T10:00:00.001Z')],
  ])('refuses issue %s', (_label, at) => {
    expect(() => prepareIssueTerms(rental, [{ costPerDay: 2500 }], at)).toThrow(
      'Booking has expired',
    );
  });

  it('refuses an unbounded booking and an empty rental', () => {
    expect(() =>
      prepareIssueTerms({ bookingExpiresAt: null }, [{ costPerDay: 2500 }], now),
    ).toThrow('Booking has expired');
    expect(() => prepareIssueTerms(rental, [], now)).toThrow('Rental has no items');
  });

  it('refuses a total that cannot be represented as an exact integer', () => {
    expect(() =>
      prepareIssueTerms(rental, [{ costPerDay: Number.MAX_SAFE_INTEGER }, { costPerDay: 2 }], now),
    ).toThrow(InvalidRentalIssueError);
  });

  it('does not mutate inputs or expose the caller clock as mutable output', () => {
    const at = new Date(now);
    const items = Object.freeze([Object.freeze({ costPerDay: 2500 })]);
    const booking = Object.freeze({ bookingExpiresAt: new Date(rental.bookingExpiresAt) });
    const first = prepareIssueTerms(booking, items, at);
    expect(prepareIssueTerms(booking, items, at)).toEqual(first);
    expect(at).toEqual(now);
    expect(booking.bookingExpiresAt).toEqual(rental.bookingExpiresAt);
    first.rentedAt.setTime(0);
    expect(at).toEqual(now);
  });
});
