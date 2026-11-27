CREATE TABLE IF NOT EXISTS nexa_auth_devices (
  device_id text PRIMARY KEY,
  public_key_spki_b64 text NOT NULL,
  roles jsonb NOT NULL,
  paired_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  label text,
  platform text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS nexa_auth_pair_codes (
  code_hash text PRIMARY KEY,
  roles jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  used_by_device_id text,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nexa_auth_pair_codes_expires_at ON nexa_auth_pair_codes(expires_at);
CREATE TABLE IF NOT EXISTS nexa_auth_challenges (
  nonce_hash text PRIMARY KEY,
  device_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nexa_auth_challenges_expires_at ON nexa_auth_challenges(expires_at);
CREATE TABLE IF NOT EXISTS nexa_auth_sessions (
  token_hash text PRIMARY KEY,
  device_id text NOT NULL,
  roles jsonb NOT NULL,
  csrf_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_nexa_auth_sessions_device ON nexa_auth_sessions(device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_nexa_auth_sessions_expires_at ON nexa_auth_sessions(expires_at);
