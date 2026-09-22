WITH selected_rentals AS (
  SELECT
    rental_id,
    rented_at
  FROM public.rentals
  WHERE renter_id = md5('renter:1')::uuid
    AND rented_at >= TIMESTAMPTZ '2025-01-01 00:00:00+00'
    AND rented_at < TIMESTAMPTZ '2026-01-01 00:00:00+00'
    AND (rented_at, rental_id) < (
      TIMESTAMPTZ '2025-07-30 00:00:00+00',
      md5('rental:31')::uuid
    )
  ORDER BY rented_at DESC, rental_id DESC
  LIMIT 20
)
SELECT
  selected_rentals.rental_id,
  selected_rentals.rented_at,
  jsonb_agg(
    jsonb_build_object(
      'game_id', game.game_id,
      'title', game.name_uk,
      'game_copy_id', game_copy.game_copy_id,
      'platform', platform.name,
      'format', game_copy.format,
      'condition', game_copy.condition,
      'returned_at', rental_item.returned_at
    )
    ORDER BY rental_item.game_copy_id
  ) AS items
FROM selected_rentals
JOIN public.rental_items AS rental_item
  ON rental_item.rental_id = selected_rentals.rental_id
JOIN public.game_copies AS game_copy
  ON game_copy.game_copy_id = rental_item.game_copy_id
JOIN public.games AS game
  ON game.game_id = game_copy.game_id
JOIN public.platforms AS platform
  ON platform.platform_id = game_copy.platform_id
GROUP BY selected_rentals.rental_id, selected_rentals.rented_at
ORDER BY selected_rentals.rented_at DESC, selected_rentals.rental_id DESC
