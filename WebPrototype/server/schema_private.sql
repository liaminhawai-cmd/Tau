-- Tau — Supabase schema, chunk 3: private matches (invite a specific person by code or link).
-- Run this once in the Supabase SQL editor, after chunk 1 (schema.sql) and chunk 2
-- (schema_matches.sql).

-- A private match starts life with only the creator filled in -- the opponent slot (red_id/
-- red_elo) stays empty until someone joins by code -- so both need to become nullable, and a
-- new 'waiting' status covers that window (distinct from 'active', which chunk 2's
-- finish_match()/rematch() etc. already assume means "both players present").
alter table public.matches alter column red_id drop not null;
alter table public.matches alter column red_elo drop not null;
alter table public.matches drop constraint if exists matches_status_check;
alter table public.matches add constraint matches_status_check check (status in ('waiting','active','finished'));
alter table public.matches add column if not exists invite_code text unique;

-- 'waiting' rows still go through the existing "players can read their own matches" policy
-- (auth.uid() = blue_id or auth.uid() = red_id): with red_id null, only the creator can see one
-- before it's joined, so a stranger can't browse other people's open invites without the code.

-- Short, easy-to-read-aloud/type: uppercase letters+digits only, with the visually-ambiguous
-- ones (0/O, 1/I/L) removed.
create or replace function public.generate_invite_code()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.matches where invite_code = code and status = 'waiting');
  end loop;
  return code;
end;
$$;

-- ---------- create_private_match(): a 'waiting' row only the creator can see yet, with a code to share ----------
create or replace function public.create_private_match()
returns table(match_id uuid, code text)
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_elo integer;
  existing_id uuid;
  existing_code text;
  new_code text;
  new_id uuid;
begin
  if me is null then return; end if;
  select elo into my_elo from public.profiles where id = me;
  if my_elo is null then return; end if;

  -- Already has an unclaimed invite out (e.g. hit "Create" twice, or reopened the invite
  -- screen) -- hand back the SAME one instead of orphaning it with a fresh code.
  select id, invite_code into existing_id, existing_code
    from public.matches where blue_id = me and status = 'waiting' and invite_code is not null
    limit 1;
  if existing_id is not null then
    match_id := existing_id; code := existing_code; return next; return;
  end if;

  new_code := public.generate_invite_code();
  insert into public.matches (blue_id, red_id, blue_elo, red_elo, status, invite_code)
  values (me, null, my_elo, null, 'waiting', new_code)
  returning id into new_id;

  match_id := new_id; code := new_code;
  return next;
end;
$$;
grant execute on function public.create_private_match() to authenticated;

-- Lets a creator abandon a waiting invite (closing the "waiting for opponent" screen) without
-- leaving a dangling row a stranger with the code could still stumble onto later.
create or replace function public.cancel_private_match(p_match_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  delete from public.matches
    where id = p_match_id and blue_id = auth.uid() and status = 'waiting';
$$;
grant execute on function public.cancel_private_match(uuid) to authenticated;

-- ---------- join_private_match(): claim a waiting invite by its code ----------
-- Race-safe the same way try_match() is: FOR UPDATE SKIP LOCKED means if two people paste the
-- same code at the same instant, only one actually claims the row -- the other gets NULL back
-- (client treats that the same as "invalid/already-used code").
create or replace function public.join_private_match(p_code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_elo integer;
  m record;
begin
  if me is null then return null; end if;
  select elo into my_elo from public.profiles where id = me;
  if my_elo is null then return null; end if;

  select * into m from public.matches
    where invite_code = upper(trim(p_code)) and status = 'waiting'
    for update skip locked;
  if m.id is null then return null; end if;
  if m.blue_id = me then return null; end if;   -- can't join your own invite

  update public.matches
    set red_id = me, red_elo = my_elo, status = 'active'
    where id = m.id;

  return m.id;
end;
$$;
grant execute on function public.join_private_match(text) to authenticated;
