# Lifter Tiers: weightlifting shoe tier list

Live at https://nathan-tran2.github.io/lifter-tiers/

Rank Olympic weightlifting shoes on bumper plates, from **S · Light weight, baby!** down to **F · Do you even lift, bro?** Famous lifts play behind the page (Lasha, Karlos Nasar, Lu Xiaojun, Shi Zhiyong, Klokov, Kianoush, Olivia Reeves, Ilya Ilyin, Li Dayin).

## What it does

- Drag shoes onto plates (long-press to drag on a phone, or tap a shoe and pick a plate). Keyboard: focus a card and press S A B C D F or R.
- **Your own shoes:** "+ Add your own shoe" puts a shoe with a photo on *your* rack only. Other people see it only when they open your list.
- **Accounts:** sign in with Apple, Google, or an emailed link. First sign-in asks for a username (`@nathan_lifts`).
- **Share and post:** your link is `…/lifter-tiers/#u=yourname`. Tick "Post my list" to put it in the community feed.
- **Community:** posted lists sorted by Top or New; like/dislike and comment on anyone's list. You can delete your own comments and any comment on your list.
- **Preview mode:** with `config.js` empty, everything except accounts and the feed still works. Lists and custom shoes save in the browser and share as a link.

## Files

| File | What it is |
|---|---|
| `index.html` | Page layout and dialogs |
| `styles.css` | Look and feel, phone layout, dark mode |
| `bg.js` | Rotating YouTube lift videos behind the page |
| `app.js` | Tier board, accounts, posting, votes, comments |
| `config.js` | Your Supabase URL and key, plus sign-in switches |
| `data/shoes.json` | The shoe list used in preview mode |
| `supabase/schema.sql` | Database tables, security rules and the starting shoes |
| `images/` | Shoe photos |

## Turning on accounts (Supabase)

1. Create a free project at https://supabase.com.
2. **SQL Editor → New query**, paste all of `supabase/schema.sql`, click **Run**. It's safe to run again whenever this file changes (it upgrades an older version in place).
3. **Project Settings → API**: copy the Project URL and the `anon` public key into `config.js`.
4. **Authentication → URL Configuration**: Site URL `https://nathan-tran2.github.io/lifter-tiers/`, and add the same URL under Redirect URLs.
5. Make yourself an admin (lets you add shoes to everyone's rack): sign in once on the site, find your user id under **Authentication → Users**, then run
   `insert into public.admins (user_id) values ('YOUR-USER-ID');`

Email sign-in works as soon as steps 1–4 are done.

### Google sign-in

1. In Google Cloud Console: **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
2. Authorized redirect URI: `https://YOUR-PROJECT.supabase.co/auth/v1/callback` (Supabase shows the exact one on the Google provider page).
3. Paste the client ID and secret into Supabase **Authentication → Providers → Google**, enable it.
4. Set `googleSignIn: true` in `config.js`.

### Sign in with Apple (iCloud)

Needs a paid Apple Developer account ($99/year).

1. In the Apple Developer portal, create an **App ID** with Sign in with Apple, then a **Services ID** (this is the client ID). Under the Services ID, add the domain `YOUR-PROJECT.supabase.co` and return URL `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
2. Create a **Key** with Sign in with Apple enabled and download the `.p8` file.
3. In Supabase **Authentication → Providers → Apple**, enter the Services ID, Team ID, Key ID and the key, and enable it. Supabase's Apple guide walks through generating the secret.
4. Set `appleSignIn: true` in `config.js`.

On iPhones, iPads and Macs the Apple button shows first; everywhere else Google does.

## Publish changes

```
git add .
git commit -m "Update tier list"
git push
```

GitHub Pages redeploys in about a minute.
