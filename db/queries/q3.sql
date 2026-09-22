SELECT
  game_id,
  name,
  name_uk,
  description,
  description_uk,
  release_date,
  game_cover_url
FROM public.games
WHERE lower(name) = lower('SYNTHETIC GAME 1')
