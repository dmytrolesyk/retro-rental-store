# Query Optimization Report

The measurements below were captured on a clean database in this order:

1. Apply `db/schema.sql`.
2. Apply `db/seed.sql`.
3. Run `EXPLAIN (ANALYZE, BUFFERS)` for Q1-Q4.
4. Apply `db/indexes.sql` and run `ANALYZE`.
5. Run the same four plans again; Q4 was run three times and the final warm result is shown.

## Q1 — renter history within a date range

### Before indexes

```text
GroupAggregate  (cost=3096.48..3103.79 rows=1 width=56) (actual time=5.989..6.636 rows=20.00 loops=1)
  Group Key: rentals.rented_at, rentals.rental_id
  Buffers: shared hit=1476
  ->  Incremental Sort  (cost=3096.48..3103.75 rows=2 width=133) (actual time=5.894..6.107 rows=60.00 loops=1)
        Sort Key: rentals.rented_at DESC, rentals.rental_id DESC, game_copy.game_copy_id
        Presorted Key: rentals.rented_at, rentals.rental_id
        Full-sort Groups: 2  Sort Method: quicksort  Average Memory: 30kB  Peak Memory: 30kB
        Buffers: shared hit=1460
        ->  Nested Loop  (cost=3089.28..3103.66 rows=2 width=133) (actual time=5.556..6.052 rows=60.00 loops=1)
              Buffers: shared hit=1454
              ->  Nested Loop  (cost=3089.15..3103.35 rows=2 width=134) (actual time=5.545..5.978 rows=60.00 loops=1)
                    Buffers: shared hit=1334
                    ->  Nested Loop  (cost=3088.73..3096.88 rows=2 width=104) (actual time=5.510..5.810 rows=60.00 loops=1)
                          Buffers: shared hit=1094
                          ->  Nested Loop  (cost=3088.45..3096.27 rows=2 width=48) (actual time=5.490..5.646 rows=60.00 loops=1)
                                Buffers: shared hit=914
                                ->  Limit  (cost=3084.01..3084.02 rows=1 width=24) (actual time=5.395..5.402 rows=20.00 loops=1)
                                      Buffers: shared hit=834
                                      ->  Sort  (cost=3084.01..3084.02 rows=1 width=24) (actual time=5.394..5.397 rows=20.00 loops=1)
                                            Sort Key: rentals.rented_at DESC, rentals.rental_id DESC
                                            Sort Method: quicksort  Memory: 27kB
                                            Buffers: shared hit=834
                                            ->  Seq Scan on rentals  (cost=0.00..3084.00 rows=1 width=24) (actual time=0.010..5.380 rows=30.00 loops=1)
                                                  Filter: ((rented_at >= '2025-01-01 00:00:00+00'::timestamp with time zone) AND (rented_at < '2026-01-01 00:00:00+00'::timestamp with time zone) AND (renter_id = '6649a693-045c-441b-7d72-ec53ba04b24a'::uuid) AND (ROW(rented_at, rental_id) < ROW('2025-07-30 00:00:00+00'::timestamp with time zone, '12d65cc8-6f93-ec12-4e8f-918e0eb5a66a'::uuid)))
                                                  Rows Removed by Filter: 99970
                                                  Buffers: shared hit=834
                                ->  Bitmap Heap Scan on rental_items rental_item  (cost=4.44..12.23 rows=2 width=40) (actual time=0.008..0.008 rows=3.00 loops=20)
                                      Recheck Cond: (rental_id = rentals.rental_id)
                                      Heap Blocks: exact=20
                                      Buffers: shared hit=80
                                      ->  Bitmap Index Scan on rental_items_pkey  (cost=0.00..4.43 rows=2 width=0) (actual time=0.006..0.006 rows=3.00 loops=20)
                                            Index Cond: (rental_id = rentals.rental_id)
                                            Index Searches: 20
                                            Buffers: shared hit=60
                          ->  Index Scan using game_copies_pkey on game_copies game_copy  (cost=0.28..0.30 rows=1 width=56) (actual time=0.002..0.002 rows=1.00 loops=60)
                                Index Cond: (game_copy_id = rental_item.game_copy_id)
                                Index Searches: 60
                                Buffers: shared hit=180
                    ->  Index Scan using games_pkey on games game  (cost=0.42..3.24 rows=1 width=46) (actual time=0.002..0.002 rows=1.00 loops=60)
                          Index Cond: (game_id = game_copy.game_id)
                          Index Searches: 60
                          Buffers: shared hit=240
              ->  Index Scan using platforms_pkey on platforms platform  (cost=0.14..0.16 rows=1 width=31) (actual time=0.001..0.001 rows=1.00 loops=60)
                    Index Cond: (platform_id = game_copy.platform_id)
                    Index Searches: 60
                    Buffers: shared hit=120
Planning:
  Buffers: shared hit=332
Planning Time: 1.527 ms
Execution Time: 6.777 ms
```

### After indexes

```text
GroupAggregate  (cost=14.90..24.21 rows=1 width=56) (actual time=0.817..1.634 rows=20.00 loops=1)
  Group Key: rentals.rented_at, rentals.rental_id
  Buffers: shared hit=643 read=3
  ->  Incremental Sort  (cost=14.90..24.18 rows=2 width=133) (actual time=0.690..1.016 rows=60.00 loops=1)
        Sort Key: rentals.rented_at DESC, rentals.rental_id DESC, game_copy.game_copy_id
        Presorted Key: rentals.rented_at, rentals.rental_id
        Full-sort Groups: 2  Sort Method: quicksort  Average Memory: 30kB  Peak Memory: 30kB
        Buffers: shared hit=627 read=3
        ->  Nested Loop  (cost=5.69..24.09 rows=2 width=133) (actual time=0.178..0.946 rows=60.00 loops=1)
              Buffers: shared hit=621 read=3
              ->  Nested Loop  (cost=5.55..23.78 rows=2 width=134) (actual time=0.116..0.801 rows=60.00 loops=1)
                    Buffers: shared hit=501 read=3
                    ->  Nested Loop  (cost=5.14..17.30 rows=2 width=104) (actual time=0.095..0.588 rows=60.00 loops=1)
                          Buffers: shared hit=261 read=3
                          ->  Nested Loop  (cost=4.85..16.70 rows=2 width=48) (actual time=0.080..0.358 rows=60.00 loops=1)
                                Buffers: shared hit=81 read=3
                                ->  Limit  (cost=0.42..4.44 rows=1 width=24) (actual time=0.059..0.134 rows=20.00 loops=1)
                                      Buffers: shared hit=1 read=3
                                      ->  Index Only Scan using idx_rentals_renter_history on rentals  (cost=0.42..4.44 rows=1 width=24) (actual time=0.058..0.129 rows=20.00 loops=1)
                                            Index Cond: ((renter_id = '6649a693-045c-441b-7d72-ec53ba04b24a'::uuid) AND (rented_at >= '2025-01-01 00:00:00+00'::timestamp with time zone) AND (rented_at < '2026-01-01 00:00:00+00'::timestamp with time zone) AND (ROW(rented_at, rental_id) < ROW('2025-07-30 00:00:00+00'::timestamp with time zone, '12d65cc8-6f93-ec12-4e8f-918e0eb5a66a'::uuid)))
                                            Heap Fetches: 0
                                            Index Searches: 1
                                            Buffers: shared hit=1 read=3
                                ->  Bitmap Heap Scan on rental_items rental_item  (cost=4.44..12.23 rows=2 width=40) (actual time=0.009..0.009 rows=3.00 loops=20)
                                      Recheck Cond: (rentals.rental_id = rental_id)
                                      Heap Blocks: exact=20
                                      Buffers: shared hit=80
                                      ->  Bitmap Index Scan on rental_items_pkey  (cost=0.00..4.43 rows=2 width=0) (actual time=0.007..0.007 rows=3.00 loops=20)
                                            Index Cond: (rental_id = rentals.rental_id)
                                            Index Searches: 20
                                            Buffers: shared hit=60
                          ->  Index Scan using game_copies_pkey on game_copies game_copy  (cost=0.28..0.30 rows=1 width=56) (actual time=0.003..0.003 rows=1.00 loops=60)
                                Index Cond: (game_copy_id = rental_item.game_copy_id)
                                Index Searches: 60
                                Buffers: shared hit=180
                    ->  Index Scan using games_pkey on games game  (cost=0.42..3.24 rows=1 width=46) (actual time=0.003..0.003 rows=1.00 loops=60)
                          Index Cond: (game_id = game_copy.game_id)
                          Index Searches: 60
                          Buffers: shared hit=240
              ->  Index Scan using platforms_pkey on platforms platform  (cost=0.14..0.16 rows=1 width=31) (actual time=0.002..0.002 rows=1.00 loops=60)
                    Index Cond: (platform_id = game_copy.platform_id)
                    Index Searches: 60
                    Buffers: shared hit=120
Planning:
  Buffers: shared hit=399 read=3
Planning Time: 2.403 ms
Execution Time: 1.823 ms
```

`idx_rentals_renter_history` replaced the sequential scan and its separate ordering sort with an index-only scan (`Heap Fetches: 0`), reducing the plan from 1476 shared-buffer hits and 6.777 ms to 643 hits plus 3 reads and 1.823 ms.

## Q2 — active rental for a physical copy

### Before indexes

```text
Nested Loop  (cost=1.40..3302.49 rows=1 width=158) (actual time=14.810..14.828 rows=1.00 loops=1)
  Buffers: shared hit=1416
  ->  Nested Loop  (cost=0.98..3294.05 rows=1 width=144) (actual time=14.790..14.807 rows=1.00 loops=1)
        Buffers: shared hit=1412
        ->  Nested Loop  (cost=0.70..3285.74 rows=1 width=108) (actual time=14.766..14.781 rows=1.00 loops=1)
              Buffers: shared hit=1409
              ->  Nested Loop  (cost=0.42..3285.44 rows=1 width=61) (actual time=14.746..14.761 rows=1.00 loops=1)
                    Buffers: shared hit=1406
                    ->  Seq Scan on rental_items rental_item  (cost=0.00..3277.00 rows=1 width=37) (actual time=14.700..14.704 rows=1.00 loops=1)
                          Filter: ((returned_at IS NULL) AND (game_copy_id = 'a2df90db-9f1b-77cd-315d-637afbaed4b8'::uuid))
                          Rows Removed by Filter: 149999
                          Buffers: shared hit=1402
                    ->  Index Scan using rentals_pkey on rentals rental  (cost=0.42..8.44 rows=1 width=40) (actual time=0.039..0.039 rows=1.00 loops=1)
                          Index Cond: (rental_id = rental_item.rental_id)
                          Index Searches: 1
                          Buffers: shared hit=4
              ->  Index Scan using renters_pkey on renters renter  (cost=0.29..0.31 rows=1 width=63) (actual time=0.016..0.017 rows=1.00 loops=1)
                    Index Cond: (renter_id = rental.renter_id)
                    Index Searches: 1
                    Buffers: shared hit=3
        ->  Index Scan using game_copies_pkey on game_copies game_copy  (cost=0.28..8.30 rows=1 width=52) (actual time=0.022..0.023 rows=1.00 loops=1)
              Index Cond: (game_copy_id = 'a2df90db-9f1b-77cd-315d-637afbaed4b8'::uuid)
              Index Searches: 1
              Buffers: shared hit=3
  ->  Index Scan using games_pkey on games game  (cost=0.42..8.44 rows=1 width=46) (actual time=0.017..0.017 rows=1.00 loops=1)
        Index Cond: (game_id = game_copy.game_id)
        Index Searches: 1
        Buffers: shared hit=4
Planning:
  Buffers: shared hit=411
Planning Time: 3.806 ms
Execution Time: 15.070 ms
```

### After indexes

```text
Nested Loop  (cost=1.67..33.78 rows=1 width=158) (actual time=0.109..0.112 rows=1.00 loops=1)
  Buffers: shared hit=15 read=2
  ->  Nested Loop  (cost=1.26..25.34 rows=1 width=144) (actual time=0.095..0.098 rows=1.00 loops=1)
        Buffers: shared hit=11 read=2
        ->  Nested Loop  (cost=0.97..17.03 rows=1 width=108) (actual time=0.077..0.078 rows=1.00 loops=1)
              Buffers: shared hit=8 read=2
              ->  Nested Loop  (cost=0.69..16.73 rows=1 width=61) (actual time=0.063..0.064 rows=1.00 loops=1)
                    Buffers: shared hit=5 read=2
                    ->  Index Scan using one_active_rental_per_copy on rental_items rental_item  (cost=0.27..8.29 rows=1 width=37) (actual time=0.043..0.043 rows=1.00 loops=1)
                          Index Cond: (game_copy_id = 'a2df90db-9f1b-77cd-315d-637afbaed4b8'::uuid)
                          Index Searches: 1
                          Buffers: shared hit=1 read=2
                    ->  Index Scan using rentals_pkey on rentals rental  (cost=0.42..8.44 rows=1 width=40) (actual time=0.017..0.017 rows=1.00 loops=1)
                          Index Cond: (rental_id = rental_item.rental_id)
                          Index Searches: 1
                          Buffers: shared hit=4
              ->  Index Scan using renters_pkey on renters renter  (cost=0.29..0.31 rows=1 width=63) (actual time=0.012..0.012 rows=1.00 loops=1)
                    Index Cond: (renter_id = rental.renter_id)
                    Index Searches: 1
                    Buffers: shared hit=3
        ->  Index Scan using game_copies_pkey on game_copies game_copy  (cost=0.28..8.30 rows=1 width=52) (actual time=0.017..0.018 rows=1.00 loops=1)
              Index Cond: (game_copy_id = 'a2df90db-9f1b-77cd-315d-637afbaed4b8'::uuid)
              Index Searches: 1
              Buffers: shared hit=3
  ->  Index Scan using games_pkey on games game  (cost=0.42..8.44 rows=1 width=46) (actual time=0.013..0.013 rows=1.00 loops=1)
        Index Cond: (game_id = game_copy.game_id)
        Index Searches: 1
        Buffers: shared hit=4
Planning:
  Buffers: shared hit=496 read=4
Planning Time: 2.863 ms
Execution Time: 0.403 ms
```

The partial unique index `one_active_rental_per_copy` replaced the 150,000-row sequential scan with a direct index scan, reducing execution from 15.070 ms and 1416 buffer hits to 0.403 ms and 15 hits plus 2 reads.

## Q3 — exact case-insensitive game title

### Before indexes

```text
Seq Scan on games  (cost=0.00..8218.00 rows=500 width=417) (actual time=29.985..115.210 rows=1.00 loops=1)
  Filter: (lower(name) = 'synthetic game 1'::text)
  Rows Removed by Filter: 99999
  Buffers: shared hit=6718
Planning:
  Buffers: shared hit=111
Planning Time: 0.850 ms
Execution Time: 115.379 ms
```

### After indexes

```text
Index Scan using idx_games_lower_name on games  (cost=0.42..8.44 rows=1 width=417) (actual time=0.158..0.159 rows=1.00 loops=1)
  Index Cond: (lower(name) = 'synthetic game 1'::text)
  Index Searches: 1
  Buffers: shared hit=1 read=3
Planning:
  Buffers: shared hit=153
Planning Time: 0.557 ms
Execution Time: 0.184 ms
```

The expression index `idx_games_lower_name` made the indexed expression match `lower(name)` in the query, replacing the sequential scan with an index scan and reducing 6718 buffer hits and 115.379 ms to 1 hit plus 3 reads and 0.184 ms.

## Q4 — Ukrainian full-text catalog search

### Before indexes

```text
Limit  (cost=7970.33..7970.38 rows=20 width=331) (actual time=55.851..55.856 rows=20.00 loops=1)
  Buffers: shared hit=6724
  ->  Sort  (cost=7970.33..7970.53 rows=80 width=331) (actual time=55.850..55.852 rows=20.00 loops=1)
        Sort Key: (ts_rank(search_vector, '''космічна'' & ''пригода'''::tsquery)) DESC, game_id
        Sort Method: top-N heapsort  Memory: 33kB
        Buffers: shared hit=6724
        ->  Seq Scan on games  (cost=0.00..7968.20 rows=80 width=331) (actual time=0.544..53.846 rows=3000.00 loops=1)
              Filter: (search_vector @@ '''космічна'' & ''пригода'''::tsquery)
              Rows Removed by Filter: 97000
              Buffers: shared hit=6718
Planning:
  Buffers: shared hit=141
Planning Time: 0.602 ms
Execution Time: 55.894 ms
```

### After indexes

```text
Limit  (cost=338.26..338.31 rows=20 width=331) (actual time=3.587..3.592 rows=20.00 loops=1)
  Buffers: shared hit=432
  ->  Sort  (cost=338.26..338.47 rows=83 width=331) (actual time=3.586..3.588 rows=20.00 loops=1)
        Sort Key: (ts_rank(search_vector, '''космічна'' & ''пригода'''::tsquery)) DESC, game_id
        Sort Method: top-N heapsort  Memory: 33kB
        Buffers: shared hit=432
        ->  Bitmap Heap Scan on games  (cost=30.49..336.06 rows=83 width=331) (actual time=0.511..2.853 rows=3000.00 loops=1)
              Recheck Cond: (search_vector @@ '''космічна'' & ''пригода'''::tsquery)
              Heap Blocks: exact=417
              Buffers: shared hit=426
              ->  Bitmap Index Scan on idx_games_search_vector  (cost=0.00..30.47 rows=83 width=0) (actual time=0.396..0.397 rows=3000.00 loops=1)
                    Index Cond: (search_vector @@ '''космічна'' & ''пригода'''::tsquery)
                    Index Searches: 1
                    Buffers: shared hit=9
Planning:
  Buffers: shared hit=199
Planning Time: 0.785 ms
Execution Time: 3.633 ms
```

The GIN index `idx_games_search_vector` replaced the full catalog scan with a bitmap index scan followed by a bitmap heap scan of matching pages, reducing 6724 buffer hits and 55.894 ms to 432 hits and 3.633 ms.

## Морфологія

The same stored `search_vector` was searched with two forms of the Ukrainian word:

```text
пригода: 3000 matches
пригоди: 1000 matches
```

The counts differ because the `simple` text-search configuration tokenizes and lowercases Ukrainian text but does not perform Ukrainian stemming or lemmatization, so `пригода` and `пригоди` remain separate lexemes.
