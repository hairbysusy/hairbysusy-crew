# crew.hairbysusy.com and team.hairbysusy.com

Two things live in this repository, both hosted on Netlify, which deploys it automatically:

1. **crew.hairbysusy.com**: the public On-Call Team sign-up.
2. **team.hairbysusy.com**: Susy's Crew, the private team app. Only the Google accounts listed in `ALLOWED_EMAILS` can sign in.
3. **HBS client pages (`/book/`)**: "Need a stylist fast?" for bookhbs.com, where clients post a job and pay the booking fee. Being tested: they open only on Netlify test links (deploy previews and branch deploys), never on the crew or team sites, and bookhbs.com doesn't point here yet.

## Files

- `site/`: the sign-up page and privacy terms, plus `_headers` (security rules) and `_redirects`
- `site/team/`: the team app's page (no data in it; it loads everything after sign-in)
- `netlify/functions/submission-created.mjs`: runs on every new application
- `netlify/functions/team-api.mjs`: the team app's server at `/api/team/*`
- `netlify/lib/team/`: shared server code (Google sign-in check, Wix storage, Wix Contacts)
- `site/book/`: the HBS client pages: home, post a job (six steps), the client's private job page, terms and privacy summaries
- `netlify/functions/book-api.mjs`: the client pages' server at `/api/book/jobs`, `/api/book/job` and `/api/book/pay`
- `netlify/lib/book/`: the job rules and booking fee (`rules.mjs`), Wix storage (`store.mjs`) and the Wix Payments checkout (`pay.mjs`)

## Where data lives

No applicant data is stored in this repository.

- Applications are stored in Netlify Forms (form name `crew`). Email alerts are set in Netlify under Forms > Submission notifications.
- The team app keeps its records in the Hair By Susy Wix site, in CMS collections only site admins can open: `HbsTeamCrew`, `HbsTeamJobs`, `HbsTeamInbox` (new applications), `HbsTeamSessions` (sign-ins, stored as hashes) and `HbsTeamLog` (who signed in and what changed, without the values).
- Each application is also added to Wix Contacts (tagged "Crew" and "Crew: To review", plus "Crew: <city>").
- Client jobs are kept in the Hair By Susy Wix site, in the admin-only CMS collection `HbsClientJobs` ("HBS: Client jobs"). Each job's private link key is stored only as a SHA-256 hash. Jobs posted from a test link are marked "Test job".
- Booking fees are paid through Wix Payments on the Hair By Susy site. Each one is an order named "HBS booking fee · Job <code> · <city>, <date>" ("TEST · " in front for test links), so refunds are made from that order in the Wix dashboard.

## Netlify environment variables

Set these in Netlify under Project configuration > Environment variables, with the Functions scope. Secrets are pasted in by Susy or Victor, never committed.

| Variable | What it is | Secret |
| --- | --- | --- |
| `WIX_API_KEY` | Wix API key for the Hair By Susy site, with Contacts and CMS (Wix Data) permissions. The client pages also need checkout and order permissions on the same key (see below) | yes |
| `GOOGLE_CLIENT_ID` | OAuth client ID (Google Cloud > Credentials, type Web application) | no |
| `GOOGLE_CLIENT_SECRET` | that client's secret | yes |
| `ALLOWED_EMAILS` | the Google accounts that may sign in, separated by commas | no |
| `SENT_API_KEY`, `SENT_ALERT_TEMPLATE_ID`, `ALERT_TO` | text alerts for new applications | key: yes |

Changes to variables take effect on the next deploy.

## Security in short

- Sign-in: Google authorization-code flow with PKCE, state and nonce; the server verifies Google's signature, issuer, audience, expiry and a verified email, then checks `ALLOWED_EMAILS`.
- Session: a random token in a `__Host-` cookie (HttpOnly, Secure, SameSite=Strict), signed, stored in Wix only as a SHA-256 hash, 14 days. Checked against `ALLOWED_EMAILS` on every request.
- Every change must come from the app's own page (custom header, Origin and Fetch-Metadata checks, JSON only). Records are size- and shape-checked; concurrent saves can't overwrite each other.
- The page allows only its own scripts (strict Content-Security-Policy, no inline code), can't be framed, and isn't indexed.
- The Wix key never reaches a browser. The app can ask Wix for eight crew-only things, and gets back only the fields it needs.

Updates pushed to the main branch are published automatically.

## HBS client pages: how the booking fee works

1. The client fills in six steps. Nothing is sent until they tap "Pay ... and post".
2. The server checks every field again (only open cities: New York for now; budget $50 to $20,000 per stylist, from $5 on test links; a same-day call time at least an hour ahead), saves the job unpaid, and asks Wix for a checkout for exactly 30% of the budget times the number of stylists. The client can't change the amount on the checkout.
3. After paying, Wix sends the client to their private job page. The server finds the paid Wix order and only then marks the job posted. An unpaid job can be paid from the same page for 48 hours.
4. Limits: 6 jobs an hour from one connection, 60 an hour in all, 8 checkouts per job.

Before it can take payments, the Wix key needs two more permissions: generating checkout sessions and reading orders. Without them the job is still saved and the page says payments aren't switched on yet.

To open another city, set `open: true` for it in `netlify/lib/book/rules.mjs` and in `site/book/post.js`. Before bookhbs.com points here: add bookhbs.com to the Netlify project, let search engines see the home page (its `noindex` tag and the `/book` rules in `_headers`; the job pages stay `noindex`), and publish the full terms and privacy policy.

