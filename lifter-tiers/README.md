# Weightlifting Shoe Tier List

Rank Olympic weightlifting shoes from **S: the holy grail** down to **F: ts sucks so fucking bad**. Every shoe starts on the rack. Sign in to save your list, share it with a link, and add shoes the rack is missing.

It's a static site (plain HTML, CSS and JavaScript, no build step) hosted on GitHub Pages, with [Supabase](https://supabase.com) for accounts, saved lists, the shared shoe database and photo uploads.

Until Supabase is connected, the site runs in **preview mode**: lists save in the browser and "Share my list" makes a link that holds the whole list.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The site |
| `config.js` | Your Supabase project URL and public key go here |
| `data/shoes.json` | The starting shoes, used in preview mode |
| `images/` | Shoe photos |
| `supabase/schema.sql` | Creates the tables, security rules, photo bucket and starting shoes |

## 1. Put it on GitHub Pages

1. Create a new public repository on GitHub, for example `lifter-tiers`, and upload these files to it (keep the folders).
2. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
3. After a minute the site is live at `https://<your-username>.github.io/lifter-tiers/`.

## 2. Turn on accounts with Supabase (free)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, and click **Run**.
3. Open **Authentication → URL Configuration**:
   - **Site URL:** `https://<your-username>.github.io/lifter-tiers/`
   - **Redirect URLs:** add the same address.
4. Open **Settings → API** and copy the **Project URL** and the **anon public** key into `config.js`:

   ```js
   window.TIER_CONFIG = {
     supabaseUrl: "https://xxxx.supabase.co",
     supabaseAnonKey: "eyJ...",
     googleSignIn: false
   };
   ```

   Both values are meant to be public. The row-level security rules in `schema.sql` are what protect the data: anyone can read shoes and lists, signed-in people can add shoes and edit only their own list, and only admins can delete shoes.
5. Commit `config.js`. The site switches from preview mode to accounts automatically.

Sign-in works by emailing a magic link, so nobody needs a password. Supabase's built-in email sender is rate-limited (a few emails an hour); for a bigger crowd, add your own SMTP under **Authentication → Emails**.

### Optional: Google sign-in

Turn on the Google provider under **Authentication → Providers** (it needs a Google Cloud OAuth client), then set `googleSignIn: true` in `config.js`.

### Make yourself an admin

Admins can remove shoes and edit any shoe. Sign in on the site once, then run this in the SQL Editor with your email:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'you@example.com'
on conflict do nothing;
```

## Tiers

| Tier | Plate | Label |
| --- | --- | --- |
| S | 25 kg red | The holy grail |
| A | 20 kg blue | Goated |
| B | 15 kg yellow | That's pretty good |
| C | 10 kg green | Meh |
| D | 5 kg white | Damn ts ass |
| F | 2.5 kg black | Ts sucks so fucking bad |

To rename them, edit the `TIERS` list at the top of `app.js`.

## Credits

Product photos come from the Rogue Fitness, TYR, LUXIAOJUN, Nike and WORKOUT.eu product pages. The barefoot photo is CC0 from the [WordPress Photo Directory](https://wordpress.org/photos/photo/78668e5706/).
