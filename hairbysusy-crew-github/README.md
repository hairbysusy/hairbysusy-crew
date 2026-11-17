# crew.hairbysusy.com and team.hairbysusy.com

Two things live in this repository, both hosted on Netlify, which deploys it automatically:

1. **crew.hairbysusy.com**: the public On-Call Team sign-up.
2. **team.hairbysusy.com**: Susy's Crew, the private team app. Only the Google accounts listed in `ALLOWED_EMAILS` can sign in.

## Files

- `site/`: the sign-up page and privacy terms, plus `_headers` (security rules) and `_redirects`
- `site/team/`: the team app's page (no data in it; it loads everything after sign-in)
- `netlify/functions/submission-created.mjs`: runs on every new application
- `netlify/functions/team-api.mjs`: the team app's server at `/api/team/*`
- `netlify/lib/team/`: shared server code (Google sign-in check, Wix storage, Wix Contacts)

## Where data lives

No applicant data is stored in this repository.

- Applications are stored in Netlify Forms (form name `crew`). Email alerts are set in Netlify under Forms > Submission notifications.
- The team app keeps its records in the Hair By Susy Wix site, in CMS collections only site admins can open: `HbsTeamCrew`, `HbsTeamJobs`, `HbsTeamInbox` (new applications), `HbsTeamSessions` (sign-ins, stored as hashes) and `HbsTeamLog` (who signed in and what changed, without the values).
- Each application is also added to Wix Contacts (tagged "Crew" and "Crew: To review", plus "Crew: <city>").

## Netlify environment variables

Set these in Netlify under Project configuration > Environment variables, with the Functions scope. Secrets are pasted in by Susy or Victor, never committed.

| Variable | What it is | Secret |
| --- | --- | --- |
| `WIX_API_KEY` | Wix API key for the Hair By Susy site, with Contacts and CMS (Wix Data) permissions | yes |
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
