-- Weightlifting Shoe Tier List: database setup for Supabase.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run.
-- It is safe to run more than once.

-- ---------- admins (people who can change the shared shoe rack) ----------
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

-- ---------- shoes: the shared rack everyone sees (admins manage it) ----------
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
drop policy if exists "adder or admin edits a shoe" on public.shoes;
drop policy if exists "admin removes shoes" on public.shoes;
drop policy if exists "admins add shoes" on public.shoes;
create policy "admins add shoes" on public.shoes for insert to authenticated with check (public.is_admin());
drop policy if exists "admins edit shoes" on public.shoes;
create policy "admins edit shoes" on public.shoes for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins remove shoes" on public.shoes;
create policy "admins remove shoes" on public.shoes for delete to authenticated using (public.is_admin());

-- ---------- lists: one per person, with their username and private shoes ----------
create table if not exists public.lists (
  user_id      uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  username     text,
  display_name text not null default 'Lifter',
  tiers        jsonb not null default '{}'::jsonb,
  custom_shoes jsonb not null default '[]'::jsonb,
  published    boolean not null default false,
  caption      text,
  updated_at   timestamptz not null default now()
);
-- columns added in this version, for databases set up from an earlier file
alter table public.lists add column if not exists username text;
alter table public.lists add column if not exists custom_shoes jsonb not null default '[]'::jsonb;
alter table public.lists add column if not exists published boolean not null default false;
alter table public.lists add column if not exists caption text;
alter table public.lists drop column if exists share_code;
do $$ begin
  alter table public.lists add constraint lists_username_format check (username is null or username ~ '^[a-z0-9_]{3,20}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lists add constraint lists_display_name_length check (char_length(display_name) between 1 and 30);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lists add constraint lists_caption_length check (caption is null or char_length(caption) <= 140);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lists add constraint lists_size check (pg_column_size(tiers) + pg_column_size(custom_shoes) < 60000);
exception when duplicate_object then null; end $$;
create unique index if not exists lists_username_key on public.lists (username);

alter table public.lists enable row level security;
drop policy if exists "lists are public" on public.lists;
create policy "lists are public" on public.lists for select using (true);
drop policy if exists "people create their own list" on public.lists;
create policy "people create their own list" on public.lists for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "people edit their own list" on public.lists;
create policy "people edit their own list" on public.lists for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "owner or admin deletes a list" on public.lists;
create policy "owner or admin deletes a list" on public.lists for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------- likes and dislikes on posted lists ----------
create table if not exists public.votes (
  list_id    uuid not null references public.lists (user_id) on delete cascade,
  voter      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (list_id, voter)
);
alter table public.votes enable row level security;
drop policy if exists "votes are public" on public.votes;
create policy "votes are public" on public.votes for select using (true);
drop policy if exists "people vote as themselves" on public.votes;
create policy "people vote as themselves" on public.votes for insert to authenticated with check (voter = auth.uid());
drop policy if exists "people change their vote" on public.votes;
create policy "people change their vote" on public.votes for update to authenticated using (voter = auth.uid()) with check (voter = auth.uid());
drop policy if exists "people take back their vote" on public.votes;
create policy "people take back their vote" on public.votes for delete to authenticated using (voter = auth.uid());

-- ---------- comments on posted lists ----------
create table if not exists public.comments (
  id          bigint generated always as identity primary key,
  list_id     uuid not null references public.lists (user_id) on delete cascade,
  author      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text,
  body        text not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now()
);
alter table public.comments enable row level security;
drop policy if exists "comments are public" on public.comments;
create policy "comments are public" on public.comments for select using (true);
drop policy if exists "people comment as themselves" on public.comments;
create policy "people comment as themselves" on public.comments for insert to authenticated with check (author = auth.uid());
drop policy if exists "author, list owner or admin deletes a comment" on public.comments;
create policy "author, list owner or admin deletes a comment" on public.comments for delete to authenticated
  using (author = auth.uid() or list_id = auth.uid() or public.is_admin());

-- The comment's name always comes from the author's own username, so nobody can post as someone else.
create or replace function public.set_comment_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author := auth.uid();
  new.author_name := coalesce((select username from public.lists where user_id = auth.uid()), 'lifter');
  new.created_at := now();
  return new;
end $$;
drop trigger if exists comments_set_author on public.comments;
create trigger comments_set_author before insert on public.comments for each row execute function public.set_comment_author();

-- ---------- shoe reviews from lifters (one per person per shoe) ----------
create table if not exists public.reviews (
  shoe_id     text not null references public.shoes (id) on delete cascade,
  author      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text,
  rating      smallint not null check (rating between 1 and 5),
  body        text check (body is null or char_length(body) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (shoe_id, author)
);
alter table public.reviews enable row level security;
drop policy if exists "reviews are public" on public.reviews;
create policy "reviews are public" on public.reviews for select using (true);
drop policy if exists "people review as themselves" on public.reviews;
create policy "people review as themselves" on public.reviews for insert to authenticated with check (author = auth.uid());
drop policy if exists "people edit their own review" on public.reviews;
create policy "people edit their own review" on public.reviews for update to authenticated
  using (author = auth.uid()) with check (author = auth.uid());
drop policy if exists "author or admin deletes a review" on public.reviews;
create policy "author or admin deletes a review" on public.reviews for delete to authenticated
  using (author = auth.uid() or public.is_admin());

-- The review's name always comes from the author's own username, and the timestamps can't be faked.
create or replace function public.set_review_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author := auth.uid();
  new.author_name := coalesce((select username from public.lists where user_id = auth.uid()), 'lifter');
  if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists reviews_set_author on public.reviews;
create trigger reviews_set_author before insert or update on public.reviews for each row execute function public.set_review_author();

-- ---------- photo storage (shoe photos people upload) ----------
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
drop policy if exists "uploaders delete their shoe photos" on storage.objects;
create policy "uploaders delete their shoe photos" on storage.objects for delete to authenticated
  using (bucket_id = 'shoe-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- starting shoes ----------
-- Non-weightlifting shoes were taken off the rack; this clears them if an older version of this file was run.
delete from public.shoes where id in ('metcon10', 'thetotal', 'cxt3', 'dropzero2', 'barepower2', 'powerprokarlos');

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
  ('barefoot', 'No shoes', 'Barefoot', 0, '0 mm', 0, 0, 'Free', 'None', 'Fits everyone', 'barefoot', 'Zero drop and maximum ground feel. Some deadlifters swear by it; for the snatch and clean you lose the heel that helps you sit upright in the bottom.', 'images/barefoot.jpg'),
  ('dowintpu', 'Do-Win', 'Weightlifting Shoe', 19, '19 mm', null, 105, null, 'Laces + 2 straps', 'Wide', 'lifter', 'Rogue''s long-running budget lifter: a ¾-inch plastic heel, two metatarsal straps and a wide profile that suits wide feet.', 'images/dowintpu.jpg'),
  ('legacy2', 'Reebok', 'Legacy Lifter II', 22, null, 612, 200, null, 'Laces + 1 strap', 'Neutral', 'lifter', 'The previous Legacy: 22 mm TPU heel, one wide strap and a reworked toe box. RunRepeat weighed it at 612 g. Easy to find on sale now that the III is out.', 'images/legacy2.jpg'),
  ('romaleos3', 'Nike', 'Romaleos 3', 20, null, 380, null, 'Discontinued', 'Laces + 1 strap', 'Narrow', 'lifter', 'Nike went light: Flywire mesh upper, one big midfoot strap and a honeycomb TPU heel, about 380 g with the soft insole. Narrow fit, and the original mesh upper had durability complaints.', 'images/romaleos3.jpg'),
  ('romaleos3xd', 'Nike', 'Romaleos 3 XD', 20, null, null, null, 'Discontinued', 'Laces + 1 strap', 'Narrow to neutral', 'lifter', 'The 2019 Extra Durability fix for the Romaleos 3: perforated leather instead of mesh, a beefier strap, same 20 mm honeycomb heel. Listed at $200 when it was current.', 'images/romaleos3xd.jpg'),
  ('heritage', 'LUXIAOJUN', 'Heritage Lifter', 22, '21.7–22.3 mm', null, 325, null, 'Laces + 2 straps', 'Roomy toe box', 'lifter', 'Lu''s old-school lifter: solid beechwood heel, genuine leather upper and Goodyear-welted construction. Slightly lower heel than the PowerPro and the classic wood-heel slap. Limited runs in white and pink.', 'images/heritage.jpg'),
  ('tyrforcev2', 'TYR', 'TYRFORCE Elite V2', null, null, null, 350, null, 'Laces + 2 straps', 'Wide toe box', 'lifter', 'The second-generation Elite Carbon: a dense wooden heel over a full-length carbon-fiber POWERPLATE, perforated leather upper and a double-strap lockdown. TYR hasn''t published the heel height yet.', 'images/tyrforcev2.jpg'),
  ('adipower1', 'Adidas', 'adiPower (original)', 20, null, 459, null, 'Discontinued', 'Laces + 1 strap', 'Narrow', 'lifter', 'The 2012-era original with a leather upper, Torsion bar and a 20.1 mm TPU heel. Many lifters still call it the best Adidas lifter ever made.', 'images/adipower1.jpg'),
  ('adipower2', 'Adidas', 'Adipower 2', 20, null, null, null, 'Discontinued', 'Laces + 1 strap', 'Narrow', 'lifter', '2019 redesign with a woven textile upper and the same 20.1 mm TPU heel as the original. Lighter and more breathable, but softer and more flexible than the OG.', 'images/adipower2.jpg'),
  ('leistung16', 'Adidas', 'Leistung 16 II', 25, '24.8 mm', 482, null, 'Discontinued', 'BOA dial', 'Narrow', 'lifter', 'The 1-inch heel Adidas: a BOA dial instead of laces and straps, a woven upper and a tall TPU wedge. Loved by high-bar squatters with tight ankles.', 'images/leistung16.jpg'),
  ('powerlift4', 'Adidas', 'Powerlift 4', 15, null, null, null, 'Discontinued', 'Laces + 1 strap', 'Narrow', 'lifter', 'The budget canvas lifter before the Powerlift 5: a 15 mm high-density EVA wedge and one strap. A gentle first step up from flat shoes.', 'images/powerlift4.jpg'),
  ('adistar', 'Adidas', 'adiStar Weightlift (2008)', null, 'Not listed', 479, null, 'Discontinued', 'Laces + 1 strap', 'Roomy square toe box', 'lifter', 'Beijing-era flagship: polished wood heel, glossy leather and a chrome Torsion shank. The last Adidas lifter with a wood heel and a collector''s grail today. Runs about a size big.', 'images/adistar.jpg'),
  ('ironwork3', 'Adidas', 'Ironwork III', null, 'Not listed', null, null, 'Discontinued', 'Laces + 1 strap', 'Neutral', 'lifter', 'Adidas'' 2008 training lifter: an exposed wooden heel wedge, perforated synthetic-leather upper and a single hook-and-loop instep strap.', 'images/ironwork3.jpg'),
  ('asics727', 'ASICS', '727 (TOW727)', null, 'Not listed', null, 369, '~$370 imported', 'Laces only', 'Wide toe box', 'lifter', 'Handmade in Japan and basically unchanged for decades: suede or leather upper, staggered lacing, no strap, and a solid wood heel nailed to a rubber sole. Hard to buy outside Japan.', 'images/asics727.jpg'),
  ('romaleos1', 'Nike', 'Romaleos (2008)', null, 'Scales with size', 620, null, 'Discontinued', 'Laces + 2 straps', 'Neutral', 'lifter', 'The original Romaleo built for the 2008 Beijing Olympics. Heel height scaled with shoe size, and it weighed about 620 g, roughly a quarter more than the Romaleos 2.', 'images/romaleos1.jpg'),
  ('legacy1', 'Reebok', 'Legacy Lifter (original)', 22, null, 575, null, 'Discontinued', 'Laces + 2 straps', 'Neutral, roomier fit', 'lifter', 'Reebok''s first true weightlifting shoe, made with CJ Cummings in 2017: 22 mm TPU heel 82 mm wide, an Exoframe heel clip and two straps. The Legacy Lifter 2 dropped to one strap.', 'images/legacy1.jpg')
on conflict (id) do nothing;

-- ---------- make yourself an admin ----------
-- After you sign in on the site once, run this with your email so you can add, edit and remove shoes on everyone's rack:
-- insert into public.admins (user_id) select id from auth.users where email = 'you@example.com' on conflict do nothing;

-- ---------- posts: Instagram-style feed (photos, lift videos, reviews, review videos, tier lists, talk) ----------
create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  author      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text,
  kind        text not null check (kind in ('lift', 'review', 'review_video', 'photo', 'video', 'tierlist', 'text')),
  shoe_id     text references public.shoes (id) on delete set null,
  caption     text check (caption is null or char_length(caption) <= 2000),
  rating      smallint check (rating is null or rating between 1 and 5),
  media_url   text check (media_url is null or (char_length(media_url) <= 600 and media_url ~ '^https://')),
  media_type  text check (media_type is null or media_type in ('image', 'video', 'youtube', 'link')),
  tiers       jsonb check (tiers is null or pg_column_size(tiers) < 20000),
  created_at  timestamptz not null default now()
);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_shoe_idx on public.posts (shoe_id);
alter table public.posts enable row level security;
drop policy if exists "posts are public" on public.posts;
create policy "posts are public" on public.posts for select using (true);
drop policy if exists "post as yourself" on public.posts;
create policy "post as yourself" on public.posts for insert to authenticated
  with check (author = auth.uid() and exists (select 1 from public.lists l where l.user_id = auth.uid() and l.username is not null));
drop policy if exists "edit own posts" on public.posts;
create policy "edit own posts" on public.posts for update to authenticated using (author = auth.uid()) with check (author = auth.uid());
drop policy if exists "delete own posts" on public.posts;
create policy "delete own posts" on public.posts for delete to authenticated using (author = auth.uid() or public.is_admin());

create or replace function public.set_post_author() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.author := coalesce(auth.uid(), new.author);
  select username into new.author_name from public.lists where user_id = new.author;
  if tg_op = 'INSERT' and auth.uid() is not null then new.created_at := now(); end if;
  return new;
end $$;
drop trigger if exists posts_author on public.posts;
create trigger posts_author before insert or update on public.posts for each row execute function public.set_post_author();

create table if not exists public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_likes enable row level security;
drop policy if exists "likes are public" on public.post_likes;
create policy "likes are public" on public.post_likes for select using (true);
drop policy if exists "like as yourself" on public.post_likes;
create policy "like as yourself" on public.post_likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "unlike yourself" on public.post_likes;
create policy "unlike yourself" on public.post_likes for delete to authenticated using (user_id = auth.uid());

create table if not exists public.post_comments (
  id          bigint generated always as identity primary key,
  post_id     uuid not null references public.posts (id) on delete cascade,
  author      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text,
  body        text not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now()
);
create index if not exists post_comments_post_idx on public.post_comments (post_id);
alter table public.post_comments enable row level security;
drop policy if exists "post comments are public" on public.post_comments;
create policy "post comments are public" on public.post_comments for select using (true);
drop policy if exists "comment as yourself" on public.post_comments;
create policy "comment as yourself" on public.post_comments for insert to authenticated
  with check (author = auth.uid() and exists (select 1 from public.lists l where l.user_id = auth.uid() and l.username is not null));
drop policy if exists "delete own post comments" on public.post_comments;
create policy "delete own post comments" on public.post_comments for delete to authenticated
  using (author = auth.uid() or public.is_admin() or exists (select 1 from public.posts p where p.id = post_id and p.author = auth.uid()));
create or replace function public.set_post_comment_author() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.author := coalesce(auth.uid(), new.author);
  select username into new.author_name from public.lists where user_id = new.author;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists post_comments_author on public.post_comments;
create trigger post_comments_author before insert on public.post_comments for each row execute function public.set_post_comment_author();

-- photos and videos people post (50 MB max per file; each user writes only inside their own folder)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', true, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update set public = true, file_size_limit = 52428800,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm'];
drop policy if exists "post media upload own folder" on storage.objects;
create policy "post media upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "post media delete own" on storage.objects;
create policy "post media delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- carry over lists that were already posted, as tier list posts
insert into public.posts (author, author_name, kind, caption, tiers, created_at)
select l.user_id, l.username, 'tierlist', nullif(l.caption, ''), l.tiers, l.updated_at
from public.lists l
where l.published and l.username is not null
  and not exists (select 1 from public.posts p where p.author = l.user_id and p.kind = 'tierlist');


-- 10 more lifters (November 2026)
insert into public.shoes (id, brand, model, heel, heel_label, weight, price, price_label, closure, fit, type, notes, photo_url) values
  ('legacy4', 'Reebok', 'Legacy Lifter IV', null, 'Not listed yet', null, 225, null, 'Laces + 1 wide strap', 'Too new to say', 'lifter', 'Reebok''s 2026 lifter: a 33 mm TPU heel clip, a wide Evo midfoot strap that Reebok says holds with twice the force, and a padded collar. Reebok hasn''t published the heel drop yet.', 'images/legacy4.jpg'),
  ('lifterpr2', 'Reebok', 'Lifter PR II', 15, null, null, 100, null, 'Laces + 1 strap', 'Neutral', 'lifter', 'A budget lifter with a 15 mm high-density EVA heel and a breathable textile upper. A good first pair or a hybrid shoe. Heavy lifters may want a firmer heel.', 'images/lifterpr2.jpg'),
  ('lifterpr3', 'Reebok', 'Lifter PR III', 18, null, null, 100, null, 'Laces + 1 strap', 'Neutral', 'lifter', 'The 2024 update to Reebok''s budget lifter. The drop goes up to 18 mm and the price stays around $100. Light enough to wear for a whole class.', 'images/lifterpr3.jpg'),
  ('fastlift360', 'Inov-8', 'Fastlift 360', 16.5, '16.5 mm', 360, 190, null, 'Laces + 1 strap', 'Narrow', 'lifter', 'Named for its weight of 360 g. It has a TPU POWERTRUSS heel cage under a 16.5 mm drop and a flexible forefoot, so it also works as a hybrid shoe on CrossFit days. Slim fit.', 'images/fastlift360.jpg'),
  ('nobull', 'NOBULL', 'Lifter', 18.5, '18.5 mm', 499, null, 'Discontinued', 'Laces + 1 strap', 'Narrow', 'lifter', 'Handmade with a stacked leather heel and a SuperFabric upper. It sold for $299, but NOBULL''s site no longer lists it, so look for used pairs.', null),
  ('powerperfect3', 'Adidas', 'Power Perfect III', 19, null, null, 120, null, 'Laces + 1 strap', 'Neutral', 'lifter', 'Adidas''s budget lifter. It has a high-density die-cut wedge with a ¾-inch heel, a synthetic leather upper and a strap that sits high, near the ankle. Tough and cheap.', 'images/powerperfect3.jpg'),
  ('strake', 'Velaasa', 'Strake', 22, null, 450, 199, null, 'Laces + 1 strap', 'Narrow toe box', 'lifter', 'A modern lifter with a real wooden heel (22 mm), from a small Minnesota brand. Reviewers love the crack of wood on the platform. It runs small and narrow, so size up.', 'images/strake.jpg'),
  ('position', 'Position USA', 'P3 / Eastwood', 25.4, '1 inch', 502, 189, '~$189 last seen', 'Laces + 1 wide strap', 'Neutral', 'lifter', 'Handmade in California with a hand-carved, stained wood heel a full inch tall, one of the tallest you can buy. Suede upper with one wide strap.', null),
  ('anta', 'ANTA', 'National Team Lifter', 20, null, null, null, '~$210–350 imported', 'Laces + 2 straps', 'Snug', 'lifter', 'The shoe ANTA makes for China''s national weightlifting team, sold abroad without the flag. It has a 20 mm TPU heel, two straps and a heavy, leather-style upper. Shops compare it to the Romaleos 2.', 'images/anta.jpg'),
  ('lxjlifter1', 'LUXIAOJUN', 'Lifter 1.0 Professional', 20, null, null, null, 'Discontinued', 'Laces + 2 straps', 'Roomy', 'lifter', 'LUXIAOJUN''s first lifter, before the PowerPro. It has a 20 mm TPU heel (95 Shore A) and two straps, and the inside is roomy. You can still find leftover stock.', 'images/lxjlifter1.jpg')
on conflict (id) do update set brand=excluded.brand, model=excluded.model, heel=excluded.heel, heel_label=excluded.heel_label, weight=excluded.weight, price=excluded.price, price_label=excluded.price_label, closure=excluded.closure, fit=excluded.fit, notes=excluded.notes, photo_url=excluded.photo_url;
