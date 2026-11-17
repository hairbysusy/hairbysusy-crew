// Settings for the private team app (team.hairbysusy.com).
// Secrets live only in Netlify environment variables, never in this repository.

export const WIX_SITE_ID_DEFAULT = '245486a5-efc7-4e35-b583-f9b546f02080'; // Hair By Susy (an id, not a secret)

export function env(name) {
  try {
    const v = globalThis.Netlify?.env?.get(name);
    if (v !== undefined && v !== null) return String(v);
  } catch { /* not running on Netlify */ }
  const v = process.env[name];
  return v === undefined || v === null ? '' : String(v);
}

export const teamHost = () => (env('TEAM_HOST') || 'team.hairbysusy.com').trim().toLowerCase();
export const teamOrigin = () => 'https://' + teamHost();
export const redirectUri = () => teamOrigin() + '/api/team/callback';

const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

// ALLOWED_EMAILS: the Google accounts that may sign in, separated by commas.
export function allowedEmails() {
  return new Set(
    env('ALLOWED_EMAILS')
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => EMAIL_RE.test(s)),
  );
}

export function googleConfig() {
  const clientId = env('GOOGLE_CLIENT_ID').trim();
  const clientSecret = env('GOOGLE_CLIENT_SECRET').trim();
  return { clientId, clientSecret, ready: Boolean(clientId && clientSecret) };
}

export const SESSION_DAYS = 14;
export const COLLECTIONS = {
  crew: 'HbsTeamCrew',
  jobs: 'HbsTeamJobs',
  inbox: 'HbsTeamInbox',
  sessions: 'HbsTeamSessions',
  log: 'HbsTeamLog',
};
