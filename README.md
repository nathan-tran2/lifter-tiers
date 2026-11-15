# Lifter Tiers: weightlifting shoe tier list

Live at https://nathan-tran2.github.io/lifter-tiers/

Rank Olympic weightlifting shoes from **S · World-record ready** down to **F · No lift**, read what review sites and other lifters say about each one, and post your list.

## Pages

- **Board** (`#/`): tap a shoe, tap a plate. Drag works too.
- **Shoes** (`#/shoes`): every shoe with specs and scores; each has its own page (`#/shoe/romaleos4`) with outside reviews, YouTube review videos, and reviews from lifters on the site.
- **Reviews** (`#/reviews`): a sortable scorecard (critics, shoppers, lifters) and the latest lifter reviews.
- **Posts** (`#/posts`): posted lists with likes, dislikes and comments.
- **Profile** (`#/profile`): username, password, your list and your reviews.

Outside review scores and video links live in `data/reviews.json`. Edit that file to add or update them.

## What it does

- Drag shoes onto plates (long-press to drag on a phone, or tap a shoe and pick a plate). Keyboard: focus a card and press S A B C D F or R.
- **Your own shoes:** "+ Add your own shoe" puts a shoe with a photo on *your* rack only. Other people see it only when they open your list.
- **Accounts:** email and password (with forgot/change password), plus optional Google, Apple, or an emailed sign-in link. First sign-in asks for a username (`@nathan_lifts`).
- **Shoe reviews:** signed-in lifters rate any shoe 1–5 stars with a written review (one per shoe, editable).
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

Password accounts work as soon as steps 1–4 are done.

**Email limits:** Supabase's built-in email only delivers to members of your Supabase team, at about 2 emails an hour. So for everyone else, confirmation emails, emailed sign-in links and password-reset emails won't arrive. Two fixes:
- Turn off **Authentication → Sign In / Providers → Email → Confirm email** so new accounts work right away without an email.
- For password resets and sign-in links, add a real email sender under **Authentication → Emails → SMTP Settings** (Resend and Brevo both have free tiers).

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
