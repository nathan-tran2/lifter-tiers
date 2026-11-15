-- Weightlifting Shoe Tier List: database setup for Supabase.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run.
-- It is safe to run more than once.

-- ---------- admins (people who can remove shoes) ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;
drop policy if exists "admins readable by self" on public.admins;
create policy "admins readable by self" on public.admins for select using (auth.uid() = user_id);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- shoes (the shared database) ----------
create table if not exists public.shoes (
  id          text primary key check (id ~ '^[a-z0-9-]{2,60}$'),
  brand       text not null check (char_length(brand) between 1 and 40),
  model       text not null check (char_length(model) between 1 and 60),
  heel        numeric check (heel is null or (heel >= 0 and heel <= 40)),
  heel_label  text check (heel_label is null or char_length(heel_label) <= 20),
  weight      integer check (weight is null or (weight >= 0 and weight <= 2000)),
  price       integer check (price is null or (price >= 0 and price <= 5000)),
  price_label text check (price_label is null or char_length(price_label) <= 20),
  closure     text check (closure is null or char_length(closure) <= 40),
  fit         text check (fit is null or char_length(fit) <= 40),
  type        text not null default 'lifter' check (type in ('lifter', 'trainer', 'barefoot', 'other')),
  notes       text check (notes is null or char_length(notes) <= 400),
  photo_url   text check (photo_url is null or char_length(photo_url) <= 400),
  added_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.shoes enable row level security;

drop policy if exists "shoes are public" on public.shoes;
create policy "shoes are public" on public.shoes for select using (true);

drop policy if exists "signed-in users add shoes" on public.shoes;
create policy "signed-in users add shoes" on public.shoes for insert to authenticated
  with check (added_by = auth.uid());

drop policy if exists "adder or admin edits a shoe" on public.shoes;
create policy "adder or admin edits a shoe" on public.shoes for update to authenticated
  using (added_by = auth.uid() or public.is_admin())
  with check (added_by = auth.uid() or public.is_admin());

drop policy if exists "admin removes shoes" on public.shoes;
create policy "admin removes shoes" on public.shoes for delete to authenticated using (public.is_admin());

-- ---------- lists (one per person) ----------
create table if not exists public.lists (
  user_id      uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text not null default 'Lifter' check (char_length(display_name) between 1 and 30),
  tiers        jsonb not null default '{}'::jsonb check (pg_column_size(tiers) < 20000),
  share_code   text unique check (share_code is null or share_code ~ '^[a-z0-9]{6,16}$'),
  updated_at   timestamptz not null default now()
);
alter table public.lists enable row level security;

drop policy if exists "lists are public" on public.lists;
create policy "lists are public" on public.lists for select using (true);

drop policy if exists "people create their own list" on public.lists;
create policy "people create their own list" on public.lists for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "people edit their own list" on public.lists;
create policy "people edit their own list" on public.lists for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "owner or admin deletes a list" on public.lists;
create policy "owner or admin deletes a list" on public.lists for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------- photo storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shoe-photos', 'shoe-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "signed-in users upload shoe photos" on storage.objects;
create policy "signed-in users upload shoe photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'shoe-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "uploaders replace their shoe photos" on storage.objects;
create policy "uploaders replace their shoe photos" on storage.objects for update to authenticated
  using (bucket_id = 'shoe-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- starting shoes ----------
insert into public.shoes (id, brand, model, heel, heel_label, weight, price, price_label, closure, fit, type, notes, photo_url) values
  ('adipower3', 'Adidas', 'Adipower Weightlifting 3', 22, null, 466, 230, null, 'Laces + 1 strap', 'Narrow to neutral', 'lifter', '22 mm TPU heel on a light chassis. Flexes enough at the toe for the back foot in a split jerk, and stays put in the catch. Fit runs on the narrow side.', 'images/adipower3.jpg'),
  ('romaleos4', 'Nike', 'Romaleos 4', 20, null, 569, 200, null, 'Laces + 2 straps', 'Narrow', 'lifter', '20 mm heel with the TPU power bridge back around the midfoot, plus two straps. Very planted. Wide feet should try it on first.', 'images/romaleos4.jpg'),
  ('romaleos2', 'Nike', 'Romaleos 2', 19, null, 477, null, 'Discontinued', 'Laces + 2 straps', 'Neutral to wide', 'lifter', 'The classic from the 2012 London Olympics. ¾-inch TPU heel, two straps, and two insoles in the box: a softer one for training and a hard one for meets. Still sold as new old stock in a few shops.', 'images/romaleos2.jpg'),
  ('powerpro', 'LUXIAOJUN', 'PowerPro', 25.5, '24.5–27 mm', null, 199, null, 'Laces + straps', 'Neutral, roomier toe box', 'lifter', 'Lü Xiaojun''s own lifter. The TPU heel is graded by size from 24.5 to 27 mm, the tallest here. Microfiber upper, and a thinner spare insole comes in the box if the fit runs tight.', 'images/powerpro.jpg'),
  ('legacy3', 'Reebok', 'Legacy Lifter III', 22, null, 627, 220, null, 'Laces + strap + Pump', 'Neutral, shallow toe box', 'lifter', '22 mm TPU heel with an external heel clip and the inflatable Pump tongue. Very stiff platform. RunRepeat weighed it as the heaviest lifter in their lab.', 'images/legacy3.jpg'),
  ('tyrl2', 'TYR', 'L-2 Lifter', 21, null, 561, 225, null, 'Laces + 2 leather straps', 'Wide toe box', 'lifter', '21 mm drop, rigid TPU midsole and a patented wide toe box. The first one to try if Nike or Adidas crush your toes. TYR suggests a half size up.', 'images/tyrl2.jpg'),
  ('tyrl1', 'TYR', 'L-1 Lifter', 21, null, null, 200, null, 'Laces + 2 straps', 'Extra wide toe box', 'lifter', 'The original wide-toe-box lifter with a 21 mm drop. Superseded by the L-2, so it often shows up discounted.', 'images/tyrl1.jpg'),
  ('tyrforce', 'TYR', 'TYRFORCE Elite Carbon', 21, null, 584, 350, null, 'Laces + 2 straps', 'Wide toe box', 'lifter', 'TYR''s top lifter: carbon construction, a 21 mm drop, leather upper and a wide fit. List price is $350, but it has been on deep sale.', 'images/tyrforce.jpg'),
  ('dowin', 'Do-Win', 'Classic Lifter', 19, '17–24 mm', null, 130, null, 'Laces + 2 straps', 'Neutral', 'lifter', 'The first lifter Rogue ever sold, brought back with a stacked genuine-leather heel. The drop is graded by size, about 19 mm in the middle sizes.', 'images/dowin.jpg'),
  ('powerlift5', 'Adidas', 'Powerlift 5', 15, null, null, 130, null, 'Laces + 1 strap', 'Narrow to neutral', 'lifter', '15 to 16 mm heel on high-density EVA, so it compresses a little under heavy loads. A good first pair, or a squat shoe for powerlifters.', 'images/powerlift5.jpg'),
  ('savaleos', 'Nike', 'Savaleos', 15, null, null, 125, null, 'Laces + 1 strap', 'Neutral', 'lifter', 'Nike''s entry lifter with a 15 mm heel and a flexible forefoot. Fine for learning the lifts; the low heel can feel off if you''re used to Romaleos.', 'images/savaleos.jpg'),
  ('metcon10', 'Nike', 'Metcon 10', null, null, null, 155, null, 'Laces', 'Runs small', 'trainer', 'A flat, stable cross-trainer with a Hyperlift plate under the heel, not a lifter. Great for a WOD; for heavy cleans you give up the heel and the rigid platform.', 'images/metcon10.jpg'),
  ('barefoot', 'No shoes', 'Barefoot', 0, '0 mm', 0, 0, 'Free', 'None', 'Fits everyone', 'barefoot', 'Zero drop and maximum ground feel. Some deadlifters swear by it; for the snatch and clean you lose the heel that helps you sit upright in the bottom.', 'images/barefoot.jpg')
on conflict (id) do nothing;

-- ---------- make yourself an admin ----------
-- After you sign in on the site once, run this with your email to be able to remove shoes:
-- insert into public.admins (user_id) select id from auth.users where email = 'you@example.com' on conflict do nothing;
