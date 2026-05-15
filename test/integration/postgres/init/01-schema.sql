CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TYPE public.mood AS ENUM ('happy', 'sad', 'neutral');
CREATE DOMAIN public.price_domain AS NUMERIC(12,2) CHECK (VALUE >= 0);
CREATE TYPE public.address AS (
  street TEXT,
  city TEXT
);

CREATE TABLE public.users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  user_id UUID PRIMARY KEY,
  display_name TEXT,
  CONSTRAINT profile_user_fk
    FOREIGN KEY (user_id)
    REFERENCES public.users(id)
);

CREATE TABLE public.projects (
  id BIGSERIAL PRIMARY KEY,
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT owner
    FOREIGN KEY (owner_id)
    REFERENCES public.users(id)
);

CREATE TABLE public.tags (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE public.project_tags (
  project_id BIGINT NOT NULL,
  tag_id BIGINT NOT NULL,
  CONSTRAINT project_tags_pk PRIMARY KEY (project_id, tag_id),
  CONSTRAINT project_fk
    FOREIGN KEY (project_id)
    REFERENCES public.projects(id),
  CONSTRAINT tag_fk
    FOREIGN KEY (tag_id)
    REFERENCES public.tags(id)
);

CREATE TABLE analytics.users (
  id BIGSERIAL PRIMARY KEY,
  external_id UUID NOT NULL UNIQUE
);

CREATE TABLE public.type_lab (
  id UUID PRIMARY KEY,
  "table" TEXT NOT NULL,
  "user" TEXT,
  "order" INTEGER,
  "MixedCase" TEXT,
  "space name" TEXT,
  small_count SMALLINT,
  big_count BIGINT,
  amount NUMERIC(20,4),
  ratio REAL,
  precise DOUBLE PRECISION,
  active BOOLEAN,
  payload JSON,
  payload_b JSONB,
  raw_bytes BYTEA,
  born_on DATE,
  at_time TIME,
  at_time_tz TIMETZ,
  created_at TIMESTAMP,
  created_at_tz TIMESTAMPTZ,
  elapsed INTERVAL,
  ip INET,
  subnet CIDR,
  mac MACADDR,
  mac8 MACADDR8,
  geo_point POINT,
  geo_lseg LSEG,
  geo_box BOX,
  geo_path PATH,
  geo_polygon POLYGON,
  geo_circle CIRCLE,
  flags BIT(8),
  flags_var BIT VARYING(16),
  content_xml XML,
  terms TSVECTOR,
  query TSQUERY,
  money_value MONEY,
  mood public.mood,
  price_domain public.price_domain,
  int_range INT4RANGE,
  int_multirange INT4MULTIRANGE,
  address public.address,
  tags TEXT[],
  matrix INTEGER[][],
  first_name TEXT NOT NULL DEFAULT 'first',
  last_name TEXT NOT NULL DEFAULT 'last',
  full_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED
);
