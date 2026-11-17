# crew.hairbysusy.com

The Hairbysusy On-Call Team sign-up. Hosted on Netlify, which deploys this repository automatically.

- `site/`: the sign-up page, privacy terms, images and the `_headers` security rules
- `netlify/functions/submission-created.mjs`: runs on every new application and texts Susy and Victor through Sent
- `netlify.toml`: tells Netlify to publish `site/` and where the function lives

Applications are stored in Netlify Forms (form name `crew`). Email alerts are set in Netlify under Forms > Submission notifications.

Text alerts need three Netlify environment variables: `SENT_API_KEY` (secret, from the Sent dashboard), `SENT_ALERT_TEMPLATE_ID` and `ALERT_TO`. See the comments at the top of the function.

Each application is also added to Contacts in the Hair By Susy Wix site (tagged "Crew" and "Crew: To review", plus a "Crew: <city>" tag per location). That needs one Netlify environment variable, `WIX_API_KEY` (secret, a Wix API key with Contacts permissions); the site ID is built in. No applicant data is stored in this repository.

Updates pushed to the main branch are published to crew.hairbysusy.com automatically.
