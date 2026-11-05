import { z } from 'zod';

// Illustrative frontend boundary: no imports from the provider's DTOs or entities.
const rentalViewSchema = z.object({
  rentalId: z.uuid(),
  renterId: z.uuid(),
  items: z.array(z.object({ gameCopyId: z.uuid(), costPerDay: z.number().int() })),
});

export type RentalView = z.infer<typeof rentalViewSchema>;

export class RentalsClient {
  constructor(private readonly baseUrl: string) {}

  async getRental(rentalId: string): Promise<RentalView> {
    const url = new URL(`/rentals/${encodeURIComponent(rentalId)}`, this.baseUrl);
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 200)
      throw new Error(`Rental API returned HTTP ${String(response.status)}`);
    const body: unknown = await response.json();
    return rentalViewSchema.parse(body);
  }
}
