CREATE INDEX idx_rentals_renter_history
ON rentals (renter_id, rented_at DESC, rental_id DESC);

CREATE UNIQUE INDEX one_active_rental_per_copy
ON rental_items (game_copy_id)
WHERE returned_at IS NULL;

CREATE INDEX idx_games_lower_name
ON games (lower(name));

CREATE INDEX idx_games_search_vector
ON games USING GIN (search_vector);
