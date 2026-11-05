/** Verified caller identity used for access decisions; contains no credentials. */
export type Principal =
  | Readonly<{ id: string; role: 'client'; renterId: string }>
  | Readonly<{ id: string; role: 'staff' }>;
