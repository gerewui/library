-- Домашняя библиотека: база данных для Supabase.
-- Вставь весь этот текст в Supabase → SQL Editor → New query и нажми Run. Запускать один раз.

create extension if not exists pgcrypto;

-- Пользователи. Первый зарегистрированный становится главным (is_owner).
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  email text,
  is_owner boolean not null default false,
  perms jsonb not null default '{}'::jsonb,   -- {"scan":true,"edit":true,"arrange":true,"setup":true}
  created_at timestamptz not null default now()
);

-- Настройки (шкафы, жанры, запас места) и текущая расстановка — по одной строке
create table if not exists public.settings (id int primary key default 1, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.layout   (id int primary key default 1, data jsonb not null, updated_at timestamptz not null default now());

-- Собрания сочинений (папки)
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  author text default '',
  genre text,
  total int,
  created_at timestamptz not null default now()
);

-- Книги
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  author text default '',
  author_key text default '',
  genre text,
  collection_id uuid references public.collections on delete set null,
  volume numeric,
  year int,
  publisher text,
  isbn text,
  annotation text,
  thick numeric, width numeric, height numeric,
  look text default 'normal',          -- beautiful | normal | worn
  pin jsonb,                           -- ручное закрепление места {"sid":"c3s5","row":"f","i":2}
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Отметки читателей: статус и оценка 1–10
create table if not exists public.marks (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  book_id uuid not null references public.books on delete cascade,
  status text,                          -- read | liked | disliked | want | null
  rating int check (rating between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

-- ---------- права ----------
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_owner from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_owner or coalesce((perms ->> p)::boolean, false) from public.profiles where id = auth.uid()), false)
$$;

-- профиль создаётся при регистрации; первый пользователь — главный
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, is_owner, perms)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
          new.email,
          not exists (select 1 from public.profiles where is_owner),
          '{}'::jsonb);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- обычный пользователь может менять только своё имя, но не права
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then
    new.is_owner := old.is_owner;
    new.perms := old.perms;
    new.email := old.email;
  end if;
  if old.is_owner and not new.is_owner and not exists (select 1 from public.profiles where is_owner and id <> old.id) then
    new.is_owner := true;  -- нельзя остаться без главного
  end if;
  return new;
end $$;
drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles for each row execute function public.guard_profile();

create or replace function public.touch() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists touch_books on public.books;
create trigger touch_books before update on public.books for each row execute function public.touch();

-- ---------- доступ (RLS) ----------
alter table public.profiles    enable row level security;
alter table public.settings    enable row level security;
alter table public.layout      enable row level security;
alter table public.collections enable row level security;
alter table public.books       enable row level security;
alter table public.marks       enable row level security;

drop policy if exists p_profiles_read on public.profiles;
create policy p_profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists p_profiles_update on public.profiles;
create policy p_profiles_update on public.profiles for update to authenticated using (id = auth.uid() or public.is_owner()) with check (id = auth.uid() or public.is_owner());
drop policy if exists p_profiles_delete on public.profiles;
create policy p_profiles_delete on public.profiles for delete to authenticated using (public.is_owner() and not is_owner);

drop policy if exists p_settings_read on public.settings;
create policy p_settings_read on public.settings for select to authenticated using (true);
drop policy if exists p_settings_write on public.settings;
create policy p_settings_write on public.settings for all to authenticated using (public.has_perm('setup')) with check (public.has_perm('setup'));

drop policy if exists p_layout_read on public.layout;
create policy p_layout_read on public.layout for select to authenticated using (true);
drop policy if exists p_layout_write on public.layout;
create policy p_layout_write on public.layout for all to authenticated
  using (public.has_perm('scan') or public.has_perm('edit') or public.has_perm('arrange'))
  with check (public.has_perm('scan') or public.has_perm('edit') or public.has_perm('arrange'));

drop policy if exists p_col_read on public.collections;
create policy p_col_read on public.collections for select to authenticated using (true);
drop policy if exists p_col_insert on public.collections;
create policy p_col_insert on public.collections for insert to authenticated with check (public.has_perm('scan') or public.has_perm('edit'));
drop policy if exists p_col_update on public.collections;
create policy p_col_update on public.collections for update to authenticated using (public.has_perm('edit')) with check (public.has_perm('edit'));
drop policy if exists p_col_delete on public.collections;
create policy p_col_delete on public.collections for delete to authenticated using (public.has_perm('edit'));

drop policy if exists p_books_read on public.books;
create policy p_books_read on public.books for select to authenticated using (true);
drop policy if exists p_books_insert on public.books;
create policy p_books_insert on public.books for insert to authenticated with check (public.has_perm('scan'));
drop policy if exists p_books_update on public.books;
create policy p_books_update on public.books for update to authenticated using (public.has_perm('edit') or public.has_perm('arrange')) with check (public.has_perm('edit') or public.has_perm('arrange'));
drop policy if exists p_books_delete on public.books;
create policy p_books_delete on public.books for delete to authenticated using (public.has_perm('edit'));

drop policy if exists p_marks_read on public.marks;
create policy p_marks_read on public.marks for select to authenticated using (true);
drop policy if exists p_marks_own on public.marks;
create policy p_marks_own on public.marks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
