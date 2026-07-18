#!/usr/bin/env node
/**
 * Cron helper: refresh Google access tokens.
 *
 * Examples:
 *   node scripts/refresh-google-tokens.js
 *   node scripts/refresh-google-tokens.js --userId=<uuid>
 *
 * Env:
 *   API_BASE_URL=https://api.socialsyncc.com
 *   CRON_SECRET=optional-shared-secret
 */

const args = process.argv.slice(2);
const userIdArg = args.find((arg) => arg.startsWith('--userId='));
const userId = userIdArg ? userIdArg.split('=')[1] : undefined;

const baseUrl = (process.env.API_BASE_URL || 'http://localhost:3000').replace(
  /\/$/,
  '',
);
const cronSecret = process.env.CRON_SECRET;

const url = new URL(`${baseUrl}/google/refresh-token`);
if (userId) {
  url.searchParams.set('userId', userId);
}

async function main() {
  const headers = {};
  if (cronSecret) {
    headers['x-cron-secret'] = cronSecret;
  }

  const response = await fetch(url.toString(), { method: 'GET', headers });
  const body = await response.text();

  if (!response.ok) {
    console.error(`Refresh failed (${response.status}): ${body}`);
    process.exit(1);
  }

  console.log(body);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
