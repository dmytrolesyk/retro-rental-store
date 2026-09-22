SELECT
  game_copy.game_copy_id,
  game.name_uk AS game_title,
  platform.name AS platform,
  game_copy.format,
  rental.rental_id,
  rental.rented_at,
  rental_item.cost_per_day,
  renter.renter_id,
  renter.name AS renter_name,
  renter.email,
  renter.phone_number
FROM public.rental_items AS rental_item
JOIN public.rentals AS rental
  ON rental.rental_id = rental_item.rental_id
JOIN public.renters AS renter
  ON renter.renter_id = rental.renter_id
JOIN public.game_copies AS game_copy
  ON game_copy.game_copy_id = rental_item.game_copy_id
JOIN public.games AS game
  ON game.game_id = game_copy.game_id
JOIN public.platforms AS platform
  ON platform.platform_id = game_copy.platform_id
WHERE rental_item.game_copy_id = md5('game-copy:1')::uuid
  AND rental_item.returned_at IS NULL
