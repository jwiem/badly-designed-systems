CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS room (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GLOBAL seq on purpose (anti-pattern): makes sparse scans hurt.
CREATE TABLE IF NOT EXISTS message (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  seq BIGSERIAL NOT NULL,
  body TEXT NOT NULL CHECK (length(body) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- polling index
CREATE INDEX IF NOT EXISTS idx_message_room_seq ON message (room_id, seq);
CREATE INDEX IF NOT EXISTS idx_message_created_at ON message (created_at);
