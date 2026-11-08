# InterviewCoach SA — Deployment Guide

This repository is pre-configured for **100% automated deployment to Vercel via GitHub**, with **zero developer intervention** and **no 404 errors** on deep links or page refreshes.

---

## Why SPAs Show 404 on Vercel (And How It Is Solved)

By default, Single Page Applications (SPAs) deployed on Vercel return a `404: NOT_FOUND` error whenever a user:
- Directly navigates to a subroute (e.g. `/Screen_2_Mock_Interview`, `/Screen_11_Drivers_License_Hub`)
- Refreshes their browser on any page other than `/`

### The Solution in this Repo:
1. **`vercel.json`**:
   - `/(.*)` rewrites directly to `/index.html` (HTTP 200).
   - `/api/(.*)` rewrites to `/api` (the serverless function bridge).
2. **`api/index.ts`**:
   - Directly exports the Express application from `server.ts` as a native Vercel Serverless Function, handling all backend API endpoints (`/api/ai/score`, `/api/health`, `/api/products`, etc.).
3. **`.github/workflows/deploy.yml`**:
   - Automated CI/CD pipeline triggered on every push to `main` or `master`.

---

## 1-Click Zero-Touch Setup via Vercel Dashboard

1. **Push this repository to GitHub** (public or private).
2. Go to [vercel.com/new](https://vercel.com/new).
3. Select your GitHub repository and click **Import**.
4. **Environment Variables**: Add your `GEMINI_API_KEY` (and Firebase credentials if running custom Firebase).
5. Click **Deploy**.

Every subsequent `git push` to your GitHub repo will trigger an automatic build and production deployment with no developer intervention needed.

---

## Custom Domain Setup: ilithafintech.co.za

To bind your custom domain **`ilithafintech.co.za`** to your Vercel deployment:

### 1. Add Domain in Vercel
1. In your Vercel Dashboard, select your project.
2. Go to **Settings > Domains**.
3. Enter `ilithafintech.co.za` and click **Add**.
4. Vercel will recommend also adding `www.ilithafintech.co.za` (with automatic redirect to the root domain).

### 2. Configure DNS Records with your Registrar (e.g. domains.co.za, Afrihost, 1-grid, xneelo)
Log in to your DNS management console and add these two DNS records:

| Record Type | Host / Name | Target / Value | TTL |
| :--- | :--- | :--- | :--- |
| **A** | `@` (or leave empty) | `76.76.21.21` | 3600 (or Auto) |
| **CNAME** | `www` | `cname.vercel-dns.com` | 3600 (or Auto) |

*Vercel will automatically provision a free SSL/TLS certificate (Let's Encrypt) within 5–15 minutes of DNS propagation.*

---

### 3. Authorize Domain in Firebase Authentication (Crucial for Google Sign-In)
Because the app uses Google Sign-In via popup (`signInWithPopup`), Firebase requires your domain to be in its authorized origins:

1. Open the [Firebase Console](https://console.firebase.google.com/project/tidal-run-503118-k2/authentication/settings).
2. Go to **Authentication > Settings > Authorized Domains**.
3. Click **Add domain**.
4. Add:
   - `ilithafintech.co.za`
   - `www.ilithafintech.co.za`
5. Click **Save**.

