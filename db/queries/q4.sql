SELECT
  game_id,
  name_uk,
  description_uk,
  game_cover_url,
  release_date,
  ts_rank(
    search_vector,
    plainto_tsquery('simple', 'космічна пригода')
  ) AS rank
FROM public.games
WHERE search_vector @@ plainto_tsquery('simple', 'космічна пригода')
ORDER BY rank DESC, game_id
LIMIT 20
