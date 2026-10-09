-- An opening's hours for each day of the week, plus live-in, as JSON (src/schedule.ts).
-- shift_preferences keeps a plain-words summary of it for emails, cards and older readers.
ALTER TABLE openings ADD COLUMN schedule_json TEXT;
