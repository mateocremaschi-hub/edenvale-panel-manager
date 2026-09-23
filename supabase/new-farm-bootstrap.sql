-- =====================================================================================
-- Panel Manager -- NEW FARM BOOTSTRAP (consolidated)
-- Run this ONCE, in the SQL Editor of a brand-new Supabase project, right after creating it.
-- Sets up every table, index, the photos storage bucket, Realtime, auth and RLS in one shot --
-- everything this app needs was previously spread across ~6 separate migrations added over
-- time (original schema, tracker_picas, panels.updated_at, Realtime, watt_class, auth). This
-- is that history collapsed into one script for every farm after Edenvale.
--
-- Column names below are reverse-engineered from the app's own sync code (lib/sync.ts,
-- lib/outboxSync.ts, lib/dronePicas.ts) as of Sept 2026, not copied from Edenvale's original
-- creation script (lost to an earlier context reset) -- correct as far as every current sync
-- path is concerned, but treat the FIRST real Excel import on this farm as the real test.
--
-- AFTER this runs:
--   1. Authentication -> Users -> Add user (your own email, tick "Auto confirm user").
--   2. update public.profiles set role = 'admin' where email = 'you@example.com';
--   3. Add this project's URL + anon key to lib/projects.ts for this farm's entry, deploy.
--   4. Sign in, then Settings -> Import Excel (master panels) and, once you have the block
--      CAD drawings, the geometry extraction (ask Claude -- same process as Edenvale's).
-- =====================================================================================

-- ---------- Core data tables ----------

create table if not exists public.locations (
  location_id         text primary key,
  block                integer not null,
  tracker              text,
  row_label            text,
  dc_box               text not null,
  array_bus            text not null,
  string_code          text not null,
  position_in_string   integer not null,
  orientation          text not null default 'unknown'
);
create index if not exists locations_block_idx on public.locations (block);
create index if not exists locations_string_code_idx on public.locations (string_code);

create table if not exists public.panels (
  panel_id             text primary key,
  serial_number        text not null,
  serial_number_short  text,
  voltage              numeric,
  watt_class           integer,
  location_id          text not null references public.locations (location_id),
  status               text not null default 'normal',
  install_date         text,
  sun_manager_id       text,
  updated_at           timestamptz not null default now()
);
create index if not exists panels_updated_at_idx on public.panels (updated_at);
create index if not exists panels_serial_number_idx on public.panels (serial_number);
create index if not exists panels_status_idx on public.panels (status);

create table if not exists public.issues (
  issue_id                     text primary key,
  location_id                  text not null references public.locations (location_id),
  panel_id_at_report           text not null,
  type                         text not null,
  severity                     text not null,
  description                  text not null default '',
  status                       text not null default 'open',
  reported_by                  text not null,
  reported_date                timestamptz not null default now(),
  sun_manager_id                text,
  requires_replacement          boolean not null default false,
  monitor_only                  boolean not null default false,
  immediate_safety_concern      boolean not null default false,
  recommended_action            text,
  photo_ids                     text[] not null default '{}',
  notes                         text
);
create index if not exists issues_location_id_idx on public.issues (location_id);
create index if not exists issues_status_idx on public.issues (status);

create table if not exists public.replacements (
  replacement_id             text primary key,
  location_id                 text not null references public.locations (location_id),
  removed_panel_id            text not null,
  removed_serial               text not null,
  installed_panel_id           text not null,
  installed_serial              text not null,
  old_voltage                   numeric, -- legacy, superseded by new_power_w
  new_voltage                   numeric, -- legacy, superseded by new_power_w
  new_power_w                   integer,
  replacement_date              timestamptz not null default now(),
  replaced_by                   text not null,
  replaced_by_name              text not null,
  sun_manager_id                 text,
  sm_uploaded                    boolean not null default false,
  reason                         text not null default '',
  related_issue_id               text,
  removed_panel_destination      text,
  photo_ids                      text[] not null default '{}',
  notes                          text
);
create index if not exists replacements_location_id_idx on public.replacements (location_id);
create index if not exists replacements_replacement_date_idx on public.replacements (replacement_date);

create table if not exists public.activity_events (
  event_id            text primary key,
  entity_type          text not null,
  entity_id             text not null,
  action                text not null,
  previous_value        text,
  new_value             text,
  operator              text not null,
  event_timestamp       timestamptz not null default now(),
  correction_of         text,
  correction_reason     text
);
create index if not exists activity_events_entity_idx on public.activity_events (entity_type, entity_id);

create table if not exists public.photos (
  photo_id       text primary key,
  related_type    text not null,
  related_id       text not null,
  storage_path     text not null,
  taken_at         timestamptz not null default now(),
  author           text not null,
  description      text,
  photo_role       text
);
create index if not exists photos_related_idx on public.photos (related_type, related_id);

-- Drone-locator survey points (north/south pica per tracker row). Populated later, once you
-- have a pica-coordinates Excel for this farm -- table stays empty and harmless until then.
create table if not exists public.tracker_picas (
  id              text primary key,
  block            integer not null,
  tracker          integer not null,
  is_motor_row     boolean not null,
  north_lat        double precision not null,
  north_lon        double precision not null,
  south_lat        double precision not null,
  south_lon        double precision not null
);
create index if not exists tracker_picas_block_idx on public.tracker_picas (block);

-- ---------- Realtime: instant panel updates across devices ----------
alter publication supabase_realtime add table public.panels;

-- ---------- Photos storage bucket ----------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

-- ---------- Auth: profiles, roles, RLS ----------
-- Everything below is identical to supabase/auth-migration.sql, included here so ONE script
-- does the whole farm. If auth-migration.sql changes in the app repo later, keep this in sync.

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text not null,
  role         text not null default 'technician' check (role in ('technician', 'coordinator', 'admin')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email, display_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(coalesce(new.email, 'user'), '@', 1)),
    'technician',
    true
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.profiles (user_id, email, display_name)
select u.id, u.email, split_part(coalesce(u.email, 'user'), '@', 1)
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin' and active
  );
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and active);
$$;

create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only enforced for app users -- the SQL editor / dashboard has no auth.uid() and is trusted
  -- (needed for the one-time "make yourself admin" bootstrap step below).
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role or new.active is distinct from old.active or new.user_id <> old.user_id then
      raise exception 'Only an admin can change roles or enable/disable accounts';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute procedure public.guard_profile_update();

do $$
declare
  t text;
  pol record;
begin
  foreach t in array array['locations','panels','issues','replacements','activity_events','photos','tracker_picas','profiles']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['locations','panels','issues','replacements','activity_events','photos','tracker_picas']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('create policy %I on public.%I for select to authenticated using (public.is_active_user())', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_active_user())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_active_user()) with check (public.is_active_user())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin())', t || '_delete', t);
  end loop;
end $$;

create policy profiles_read   on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (user_id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy profiles_delete on public.profiles for delete to authenticated using (public.is_admin());

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'photos_%' loop
    execute format('drop policy if exists %I on storage.objects', pol.policyname);
  end loop;
end $$;
create policy photos_read   on storage.objects for select to authenticated using (bucket_id = 'photos' and public.is_active_user());
create policy photos_insert on storage.objects for insert to authenticated with check (bucket_id = 'photos' and public.is_active_user());
create policy photos_update on storage.objects for update to authenticated using (bucket_id = 'photos' and public.is_active_user());
create policy photos_delete on storage.objects for delete to authenticated using (bucket_id = 'photos' and public.is_admin());
