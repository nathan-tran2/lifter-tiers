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
