// Where are we? Two answers: which *product* (figma / octane / a normal app),
// used to rank tools in the palette; and which *app + environment* from the
// user's env map, used by checkpoints, the env switcher and request replay.
//
// The env map is per app — there is no shared host pattern across apps:
//   { billing: { dev: 'http://localhost:3000', test: 'https://billing-test.corp', prod: 'https://billing.corp' } }

export function detectSite(host = location.hostname, path = location.pathname) {
  if (/(^|\.)figma\.com$/.test(host)) return 'figma';
  if (/octane|almoctane|saas\.microfocus|opentext/i.test(host + path)) return 'octane';
  return 'web';
}

const normOrigin = (s) => {
  try { return new URL(String(s).includes('://') ? s : `https://${s}`).origin; } catch { return String(s).replace(/\/+$/, ''); }
};

/** Look the current origin up across every app's hosts. */
export function resolveEnv(envMap = {}, origin = location.origin) {
  const target = normOrigin(origin);
  for (const [app, envs] of Object.entries(envMap ?? {})) {
    if (!envs || typeof envs !== 'object') continue;
    for (const [env, host] of Object.entries(envs)) {
      if (host && normOrigin(host) === target) return { app, env, origin: target };
    }
  }
  return null;
}

/** Default app/env for a page: env map first, else hostname / 'unknown'. */
export function describeOrigin(envMap, origin = location.origin) {
  const hit = resolveEnv(envMap, origin);
  if (hit) return hit;
  let host = origin;
  try { host = new URL(origin).hostname; } catch { /* keep */ }
  return { app: host.replace(/^www\./, ''), env: 'unknown', origin };
}

export function originFor(envMap, app, env) {
  const host = envMap?.[app]?.[env];
  return host ? normOrigin(host) : null;
}

/** Every env of one app, as [{ env, origin, current }]. */
export function envsFor(envMap, app, currentOrigin = location.origin) {
  return Object.entries(envMap?.[app] ?? {}).map(([env, host]) => ({
    env, origin: normOrigin(host), current: normOrigin(host) === normOrigin(currentOrigin),
  }));
}

/** Same path, another origin. */
export function rewriteOrigin(url, toOrigin) {
  try {
    const u = new URL(url, location.href);
    const t = new URL(toOrigin);
    u.protocol = t.protocol; u.host = t.host;
    return u.toString();
  } catch { return url; }
}

/** Replace every occurrence of one origin inside a string value. */
export function rewriteValue(value, fromOrigin, toOrigin) {
  if (typeof value !== 'string' || !fromOrigin || fromOrigin === toOrigin) return value;
  return value.split(fromOrigin).join(toOrigin);
}

/** Validate an env-map edit before it is saved. Returns a list of problems. */
export function validateEnvMap(map) {
  const problems = [];
  if (!map || typeof map !== 'object' || Array.isArray(map)) return ['env map must be an object of apps'];
  for (const [app, envs] of Object.entries(map)) {
    if (!envs || typeof envs !== 'object' || Array.isArray(envs)) { problems.push(`${app}: must map env names to origins`); continue; }
    for (const [env, host] of Object.entries(envs)) {
      if (typeof host !== 'string' || !host) { problems.push(`${app}.${env}: origin must be a string`); continue; }
      try { new URL(host.includes('://') ? host : `https://${host}`); } catch { problems.push(`${app}.${env}: "${host}" is not a URL`); }
    }
  }
  return problems;
}
