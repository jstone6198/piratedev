import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import fs from 'fs';
import { randomUUID } from 'crypto';

/**
 * Find or create a user linked to an OAuth provider.
 * Reads/writes config/users.json.
 */
export function findOrCreateOAuthUser(provider, profile, usersPath) {
  const raw = fs.readFileSync(usersPath, 'utf-8');
  const data = JSON.parse(raw);
  const users = Array.isArray(data.users) ? data.users : [];

  const oauthId = String(profile.id);
  let user = users.find(
    (u) => u.oauthProvider === provider && u.oauthId === oauthId
  );

  if (user) return user;

  // Derive a username from the profile
  let username =
    profile.username ||
    (profile.emails && profile.emails[0] && profile.emails[0].value
      ? profile.emails[0].value.split('@')[0]
      : `${provider}-${oauthId}`);

  // Ensure uniqueness
  const baseUsername = username;
  let suffix = 1;
  while (users.some((u) => u.username === username)) {
    username = `${baseUsername}${suffix}`;
    suffix++;
  }

  user = {
    username,
    role: 'user',
    oauthProvider: provider,
    oauthId,
    email:
      profile.emails && profile.emails[0]
        ? profile.emails[0].value
        : undefined,
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  fs.writeFileSync(usersPath, JSON.stringify({ users }, null, 2));
  return user;
}

/**
 * Configure Passport with GitHub and Google strategies.
 * Strategies are only registered when their env vars are present.
 */
export function configurePassport(usersPath) {
  const callbackBase =
    process.env.OAUTH_CALLBACK_BASE || 'https://app.piratedev.ai';

  passport.serializeUser((user, done) => done(null, user.username));
  passport.deserializeUser((username, done) => {
    try {
      const raw = fs.readFileSync(usersPath, 'utf-8');
      const users = JSON.parse(raw).users || [];
      done(null, users.find((u) => u.username === username) || null);
    } catch (err) {
      done(err);
    }
  });

  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
          callbackURL: `${callbackBase}/api/auth/github/callback`,
          scope: ['user:email'],
        },
        (_accessToken, _refreshToken, profile, done) => {
          try {
            const user = findOrCreateOAuthUser('github', profile, usersPath);
            done(null, user);
          } catch (err) {
            done(err);
          }
        }
      )
    );
    console.log('[oauth] GitHub strategy configured');
  }

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: `${callbackBase}/api/auth/google/callback`,
          scope: ['profile', 'email'],
        },
        (_accessToken, _refreshToken, profile, done) => {
          try {
            const user = findOrCreateOAuthUser('google', profile, usersPath);
            done(null, user);
          } catch (err) {
            done(err);
          }
        }
      )
    );
    console.log('[oauth] Google strategy configured');
  }
}
