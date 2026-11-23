# bookhbs.com, crew.hairbysusy.com and team.hairbysusy.com

These live in this repository, all on one Netlify project, which deploys it automatically:

1. **bookhbs.com**: HBS on one site. The home page is "Need a stylist fast?" (the `/book/` pages), where clients post a job and pay the booking fee, and stylists apply at **bookhbs.com/apply**. Client posting opens on Susy's word: until then bookhbs.com says booking opens soon and takes no jobs (see "Opening client posting" below).
2. **crew.hairbysusy.com**: the On-Call Team sign-up's old address. Its page sends visitors to bookhbs.com/apply; the city confirmation links (/city/) still open here.
3. **team.hairbysusy.com**: Susy's Crew, the private team app. Only the Google accounts listed in `ALLOWED_EMAILS` can sign in. It stays on its own address, apart from the public site.

The test link for the client pages is https://hairbysusy-crew.netlify.app/book/ (marked as a test link, hidden from search): it can always post, as a test. The client pages never open on the crew or team sites. Deploy previews show the pages too, but can't post: Netlify keeps the Wix key out of deploy previews of this public repository, which is the safe setting.

## Files

- `site/`: the sign-up page and privacy terms, plus `_headers` (security rules) and `_redirects` (which address shows what)
- `site/apply/`: the sign-up page at /apply/ (bookhbs.com/apply). It is the same file as `site/index.html`; edit both. The form sends applications to /apply/, so no rule in `_redirects` may ever match /apply/ (a rule there would swallow them).
- `site/team/`: the team app's page (no data in it; it loads everything after sign-in)
- `netlify/functions/submission-created.mjs`: runs on every new application
- `netlify/functions/team-api.mjs`: the team app's server at `/api/team/*`
- `netlify/lib/team/`: shared server code (Google sign-in check, Wix storage, Wix Contacts)
- `site/book/`: the HBS client pages: home, post a job (six steps), the client's private job page, each stylist's private job page (`/book/s/`), terms and privacy summaries
- `netlify/functions/book-api.mjs`: the client pages' server at `/api/book/*` (post, pay, the client's job, the address, the stylist's job and her answer)
- `netlify/lib/book/`: the job rules and booking fee (`rules.mjs`), Wix storage (`store.mjs`), the Wix Payments checkout (`pay.mjs`), what happens after payment (`flow.mjs`) and the signed private links (`links.mjs`)

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

## HBS client jobs: after the client pays

1. The job shows in the team app under **Clients**, with the client's details, the booking fee and Wix order number, and the approved full-job stylists who take clients in that city (fastest to reply first).
2. **Text** opens Messages with the job and that stylist's own link (`/book/s/`). She taps "I'm available" or "Not this time" on that page, and the answer shows in the team app. The client's job page shows each yes, without names.
3. The team calls who said yes, then taps **Book**. Once enough stylists are booked the job is matched: the others who said yes see it went to another stylist, the booked stylist sees the client's first name, and the client sees the stylist's first name and adds the exact address. The stylist sees the address from the day before the job.
4. **Text client** and **Text booked** send the right message with the right link. Until texting through Sent is switched on, these texts go from the team's own phone.
5. Cancelling a job in the team app tells everyone on their pages. Refunds are made from the Wix order.

Private links are signed, not stored (`links.mjs`): each one is an HMAC of the job (and stylist) under a key derived from `GOOGLE_CLIENT_SECRET`, so the team app can rebuild any link and nothing in Wix can be turned into one.

To open another city, set `open: true` for it in `netlify/lib/book/rules.mjs` and in `site/book/post.js`.

## bookhbs.com

`_redirects` does the routing: bookhbs.com/ shows the HBS home page (`/book/`), www.bookhbs.com goes to bookhbs.com, /crew and /join go to /apply/, /team goes to team.hairbysusy.com, and /city links go to crew.hairbysusy.com (where that page's server answers).

**Opening client posting** (on Susy's word): set `LIVE_OPEN` to `true` in `netlify/lib/book/rules.mjs` and in `site/book/common.js`, remove the two `bookhbs.com/book/post` lines in `_redirects`, and show the Post a job buttons without waiting for the script (in `site/book/index.html`, take `hidden` off `menuPost`, `heroPost`, `againOpen` and `againPost`, and put it on `heroSoon` and `againSoon`). At launch, also let search engines see the home page (its `noindex` tag; the job pages stay `noindex`) and publish the full terms and privacy policy.

