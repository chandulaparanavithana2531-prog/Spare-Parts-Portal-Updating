# Security & Email Setup (one-time)

These steps finish the security fix. Do them in this order.

## 1. Revoke the leaked Gmail App Password (do this first)
The old App Password for the sender Gmail account was committed to this repo.
1. Sign in to that Google account → https://myaccount.google.com/apppasswords
2. Delete the old "SpareShare" app password.
3. Create a new one and copy the 16 characters (used in step 3 as `SMTP_PASS`).

## 2. Create a Firebase service account key
Firebase Console → Project settings → **Service accounts** → **Generate new private key**.
A JSON file downloads. Keep it private; never commit it.

## 3. Add environment variables in Vercel
Vercel → this project → Settings → **Environment Variables** (Production + Preview):

| Name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Full contents of the JSON from step 2 (paste as-is) |
| `SMTP_USER` | `sparevone@gmail.com` |
| `SMTP_PASS` | New App Password from step 1 |
| `SMTP_FROM` | `SpareShare Enterprise Portal <sparevone@gmail.com>` |
| `APP_URL` | Live portal URL, e.g. `https://xxxx.vercel.app` (no trailing slash) |
| `ACTION_SECRET` | Any long random string (40+ characters) |
| `EMAIL_DRY_RUN` | Set to `true` only for testing; remove/disable it for actual delivery |
| `ADMIN_INITIAL_PASSWORD` | Only if there is no `admin` document in Firestore `users`; a strong new password |
| `ADMIN_EMAIL` | Admin's real email (optional, used with the line above) |

Also **delete** any `VITE_API_URL` variable in Vercel (or leave it empty).
Then **Redeploy** (Deployments → ⋯ → Redeploy).

## 4. Test
1. Log in as admin and as one plant user. Login now goes through `/api/login`.
2. In User Management, make sure every target plant has at least one approved registered user with a **real** email.
  Request emails are resolved on the server from the target plant's registered Firestore users.
3. Place a small test order → check both the requester and the plant inbox.
4. Click **Approve** in the plant email → confirm → requester gets an update email.

## 5. Lock the database
Only after step 4 works: Firebase Console → Firestore Database → **Rules** → paste `firestore.rules` from this repo → **Publish**.

## What changed in the code
- Mail uses the shared SMTP transport and the sender is restricted to `sparevone@gmail.com`.
- No generic arbitrary-recipient email endpoint is exposed; order notifications resolve recipients by registered plant account.
- Do not commit `.env` files, service-account JSON, archives, or temporary spreadsheets. Rotate any secret that was ever committed.
- Login is checked on the server (`api/login.js`), which issues a Firebase token with the user's role and plant.
  Old plain-text passwords are upgraded to hashes on first login.
- Order emails use `/api/orders/created` and `/api/orders/status-updated`; mail failures and missing target recipients are recorded on the order.
- Admins can resend a pending order request email from Order Management.
- `api/orders/action.js`: signed Approve/Reject links (expire after 7 days and are single-use) with a confirm step,
  so link scanners in Outlook/Gmail cannot approve by just opening the link.
- `firestore.rules`: only signed-in users can read/write; only admins manage users and clear logs.

## Local development
Copy `.env.example` to `.env.local`, fill it in, then run `npm run server` and `npm run dev`.
Vite forwards `/api/*` to the local Express server.
