do $$
begin
	create type public.app_role as enum ('husband', 'wife');
exception
	when duplicate_object then null;
end $$;

do $$
begin
	create type public.wife_status as enum ('not_ready', 'interested_later', 'ready_now');
exception
	when duplicate_object then null;
end $$;

create table if not exists public.profiles (
	id uuid primary key references auth.users (id) on delete cascade,
	role public.app_role not null unique,
	display_name text not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.shared_status (
	id smallint primary key default 1 check (id = 1),
	husband_is_taped boolean not null default false,
	tape_estimated_off timestamptz,
	wife_status public.wife_status not null default 'not_ready',
	last_updated timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references public.profiles (id) on delete cascade,
	endpoint text not null unique,
	subscription jsonb not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

insert into public.shared_status (id)
values (1)
on conflict (id) do nothing;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at
	before update on public.profiles
	for each row execute function public.touch_updated_at();

drop trigger if exists touch_push_subscriptions_updated_at on public.push_subscriptions;
create trigger touch_push_subscriptions_updated_at
	before update on public.push_subscriptions
	for each row execute function public.touch_updated_at();

create or replace function public.enforce_shared_status_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	current_role public.app_role;
begin
	select role into current_role
	from public.profiles
	where id = auth.uid();

	if current_role is null then
		raise exception 'Only profiled users can update shared_status';
	end if;

	if current_role = 'husband' then
		if new.wife_status is distinct from old.wife_status then
			raise exception 'Husband cannot update wife_status';
		end if;
	elsif current_role = 'wife' then
		if new.husband_is_taped is distinct from old.husband_is_taped
			or new.tape_estimated_off is distinct from old.tape_estimated_off then
			raise exception 'Wife cannot update husband tape status';
		end if;
	end if;

	new.last_updated = now();
	return new;
end;
$$;

drop trigger if exists enforce_shared_status_role on public.shared_status;
create trigger enforce_shared_status_role
	before update on public.shared_status
	for each row execute function public.enforce_shared_status_role();

alter table public.profiles enable row level security;
alter table public.shared_status enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
	on public.profiles
	for select
	using (auth.uid() = id);

drop policy if exists "Profiled users can read shared status" on public.shared_status;
create policy "Profiled users can read shared status"
	on public.shared_status
	for select
	using (
		exists (
			select 1 from public.profiles
			where profiles.id = auth.uid()
		)
	);

drop policy if exists "Profiled users can update shared status" on public.shared_status;
create policy "Profiled users can update shared status"
	on public.shared_status
	for update
	using (
		exists (
			select 1 from public.profiles
			where profiles.id = auth.uid()
		)
	)
	with check (
		exists (
			select 1 from public.profiles
			where profiles.id = auth.uid()
		)
	);

drop policy if exists "Users can read their own push subscriptions" on public.push_subscriptions;
create policy "Users can read their own push subscriptions"
	on public.push_subscriptions
	for select
	using (auth.uid() = user_id);

drop policy if exists "Users can save their own push subscriptions" on public.push_subscriptions;
create policy "Users can save their own push subscriptions"
	on public.push_subscriptions
	for insert
	with check (auth.uid() = user_id);

drop policy if exists "Users can update their own push subscriptions" on public.push_subscriptions;
create policy "Users can update their own push subscriptions"
	on public.push_subscriptions
	for update
	using (auth.uid() = user_id)
	with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own push subscriptions" on public.push_subscriptions;
create policy "Users can delete their own push subscriptions"
	on public.push_subscriptions
	for delete
	using (auth.uid() = user_id);

do $$
begin
	if not exists (
		select 1
		from pg_publication_tables
		where pubname = 'supabase_realtime'
			and schemaname = 'public'
			and tablename = 'shared_status'
	) then
		alter publication supabase_realtime add table public.shared_status;
	end if;
end $$;

-- After both people have been created in Supabase Auth with email/password,
-- replace the email addresses below and run this seed block.
-- insert into public.profiles (id, role, display_name)
-- select id, 'husband', 'Husband'
-- from auth.users
-- where email = 'husband@example.com'
-- on conflict (id) do update
-- set role = excluded.role,
-- 	display_name = excluded.display_name;
--
-- insert into public.profiles (id, role, display_name)
-- select id, 'wife', 'Wife'
-- from auth.users
-- where email = 'wife@example.com'
-- on conflict (id) do update
-- set role = excluded.role,
-- 	display_name = excluded.display_name;
