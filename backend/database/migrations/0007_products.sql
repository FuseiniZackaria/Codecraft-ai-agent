-- 0007: Products (Settings -> General -> Products) - the catalogue the WhatsApp
-- agent uses to answer "do you have...?", match customer photos, check stock
-- and send product photos.
--
-- HOW TO RUN
--   1. Back up first (free plan: `node backend/scripts/backup-db.js --label=pre-0007`).
--   2. Supabase -> SQL Editor -> New query -> paste this whole file -> Run.
--   3. You should see "Success. No rows returned". Safe to run more than once.
--
-- WHAT IT ADDS (one set per workspace = per business)
--   products           name, other names, price, stock, photo, link, where it came from
--   product_sources    websites to import from, with "re-sync daily" and the last result
--   product_synonyms   local words (Pidgin/Twi/slang) -> what they mean, for search
--   search_products()  spelling-tolerant search (pg_trgm, built into Postgres, free)
-- Nothing existing is changed.

begin;

create extension if not exists pg_trgm;

create table if not exists products (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  name           text not null,
  aliases        text not null default '',          -- other names, comma-separated ("jollof, jolof rice")
  description    text,
  category       text,
  price          numeric(12, 2),
  currency       text not null default 'GHS',
  stock_status   text not null default 'unknown',   -- in_stock | out_of_stock | unknown | always_available
  stock_qty      integer,
  image_url      text,
  product_url    text,
  source         text not null default 'manual',    -- manual | csv | website
  source_id      uuid,                              -- product_sources row it was imported from
  external_id    text,                              -- id at the source (for re-sync)
  active         boolean not null default true,     -- off = hidden from the agent (also: removed at the source)
  stock_checked_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  search         tsvector generated always as (
                   to_tsvector('english', coalesce(name, '') || ' ' || coalesce(aliases, '') || ' ' ||
                                          coalesce(category, '') || ' ' || coalesce(description, ''))) stored
);
create index if not exists products_ws on products (workspace_id);
create index if not exists products_search on products using gin (search);
create index if not exists products_name_trgm on products using gin ((lower(name || ' ' || aliases)) gin_trgm_ops);
create unique index if not exists products_external_uidx on products (workspace_id, source, external_id) where external_id is not null;

create table if not exists product_sources (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  url            text not null,
  kind           text not null default 'website',
  daily_sync     boolean not null default true,
  last_synced_at timestamptz,
  last_status    text,                              -- ok | failed | running
  last_error     text,
  last_method    text,                              -- shopify | woocommerce | structured-data | page-text
  item_count     integer not null default 0,
  created_at     timestamptz not null default now(),
  unique (workspace_id, url)
);

create table if not exists product_synonyms (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  term         text not null,                      -- what customers say, e.g. "chalewote"
  means        text not null,                      -- what it means, e.g. "slippers"
  created_at   timestamptz not null default now(),
  unique (workspace_id, term)
);

-- Spelling-tolerant search. p_query is the customer's key words (the backend
-- removes filler words first). A product matches when its name or one of its
-- other names appears in the words, even misspelled ("jolof" -> "Jollof Rice"),
-- or when the words match its description/category (full-text).
create or replace function search_products(p_workspace uuid, p_query text, p_limit integer default 10)
returns table (product products, score real)
language sql stable
as $$
  select p, s.score
  from products p,
  lateral (
    select greatest(
      word_similarity(lower(p.name), lower(p_query)),
      coalesce((select max(word_similarity(lower(trim(a)), lower(p_query)))
                from unnest(string_to_array(p.aliases, ',')) a where trim(a) <> ''), 0),
      case when p.search @@ websearch_to_tsquery('english', replace(p_query, ' ', ' or ')) then 0.5 else 0 end,
      -- one close word is enough ("trowser" -> "Slim Black Trouser")
      coalesce((select case when max(word_similarity(w, lower(p_query))) >= 0.42
                            then 0.4 + 0.5 * max(word_similarity(w, lower(p_query))) else 0 end
                from unnest(regexp_split_to_array(lower(p.name || ' ' || replace(p.aliases, ',', ' ')), '\s+')) w
                where length(w) >= 4), 0)
    )::real as score
  ) s
  where p.workspace_id = p_workspace
    and p.active
    and s.score >= 0.45
  order by s.score desc, p.name
  limit greatest(1, least(p_limit, 50));
$$;

alter table products         enable row level security;
alter table product_sources  enable row level security;
alter table product_synonyms enable row level security;

do $$
declare t text;
begin
  foreach t in array array['products', 'product_sources', 'product_synonyms'] loop
    execute format('drop policy if exists %I on %I', t || '_members', t);
    execute format(
      'create policy %I on %I for all
         using (exists (select 1 from workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = auth.uid()))
         with check (exists (select 1 from workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = auth.uid()))',
      t || '_members', t, t, t);
  end loop;
end $$;

commit;
