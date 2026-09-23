-- =====================================================================================
-- Panel Manager -- authentication & roles (stage 2 of multi-farm)
-- Run ONCE per farm's Supabase project, in the SQL editor.
--
-- ORDER MATTERS: deploy the app build that has the sign-in screen FIRST, then run this.
-- Once this runs, the anon key alone can no longer read or write data -- every device must be
-- signed in. Devices still on the old build would stop syncing until updated.
--
-- After running: create users in Authentication -> Users -> "Add user" (email + password,
-- tick "Auto confirm"). Each new user gets a `profiles` row as 'technician' automatically.
-- Then sign in to the app with YOUR user and promote yourself to admin with:
--   update public.profiles set role = 'admin' where email = 'you@example.com';
-- (the one time an admin has to be set from SQL -- after that, Settings -> Users does it).
-- =====================================================================================

-- 1) Profiles: one row per auth user, holds the app role.
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text not null,
  role         text not null default 'technician' check (role in ('technician', 'coordinator', 'admin')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Create the profile automatically when a user is added in the dashboard.
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

-- Backfill profiles for users that already exist.
insert into public.profiles (user_id, email, display_name)
select u.id, u.email, split_part(coalesce(u.email, 'user'), '@', 1)
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null;

-- 2) Helper: is the caller an active admin? (security definer so RLS on profiles can use it)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin' and active
  );
$$;

-- Non-admins may edit their own display_name but never their own role/active flag.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
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

-- 3) Row Level Security on every table the app uses.
-- Drops whatever policies existed (the original anon-open ones) and installs:
--   read/insert/update  -> any signed-in, active user
--   delete              -> admins only
--   app_config writes   -> admins only
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array['locations','panels','issues','replacements','activity_events','photos','tracker_picas','app_config','profiles']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;
  end loop;
end $$;

-- Signed-in AND active: every data table.
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and active);
$$;

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

-- app_config (shared settings): everyone reads, admins write.
create policy app_config_read   on public.app_config for select to authenticated using (public.is_active_user());
create policy app_config_write  on public.app_config for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles: everyone signed in can read (names for "who did this"); you can update your own
-- row (trigger above stops role changes); admins can update anyone; inserts allowed for own row
-- (first-sign-in fallback) or by admins.
create policy profiles_read   on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (user_id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy profiles_delete on public.profiles for delete to authenticated using (public.is_admin());

-- 4) Photo storage bucket: signed-in users only.
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
