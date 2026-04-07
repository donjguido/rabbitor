# Tiered AI Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add free/paid tier system with OAuth auth, Stripe payments, usage metering, and model gating so users can access AI without their own API keys.

**Architecture:** Vercel serverless functions handle auth, payments, and AI proxying. Vercel Postgres stores users/subscriptions/usage. Vercel KV caches rate limits. The client-side `Annotator.jsx` gains auth state, a shared-key toggle, and usage display. The existing BYOK flow is fully preserved.

**Tech Stack:** React 19, Vite 8, Vercel Serverless Functions (Node.js), Vercel Postgres (`@vercel/postgres`), Vercel KV (`@vercel/kv`), Stripe (`stripe`), `jose` (JWT), `arctic` (OAuth)

---

## File Structure

```
api/
  lib/
    db.js            — Postgres client, query helpers, schema init
    auth.js          — JWT sign/verify, cookie helpers, session extraction
    usage.js         — Rate limit check, usage increment, tier detection
    models.js        — Model mapping (free/paid tier → provider model IDs)
  auth/
    github.js        — GitHub OAuth initiation
    google.js        — Google OAuth initiation
    callback.js      — OAuth callback handler (both providers)
    session.js       — GET current user + tier + usage info
    logout.js        — Clear session cookie
  stripe/
    checkout.js      — Create Stripe Checkout session
    portal.js        — Create Stripe Customer Portal session
    webhook.js       — Handle Stripe webhook events
  chat.js            — Upgraded: auth-aware proxy with rate limiting + model gating
src/
  Annotator.jsx      — Modified: auth UI, shared-key toggle, usage display, upgrade prompts
```

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install server-side dependencies**

```bash
npm install @vercel/postgres @vercel/kv stripe jose arctic
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('@vercel/postgres'); require('@vercel/kv'); require('stripe'); require('jose'); require('arctic'); console.log('All deps OK')"
```

Expected: `All deps OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add deps for auth, payments, and database"
```

---

### Task 2: Database Client & Schema Initialization

**Files:**
- Create: `api/lib/db.js`

- [ ] **Step 1: Create the database helper module**

```js
// api/lib/db.js
import { sql } from "@vercel/postgres";

export { sql };

export async function initSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email           TEXT UNIQUE NOT NULL,
      name            TEXT,
      avatar_url      TEXT,
      provider        TEXT NOT NULL,
      provider_id     TEXT NOT NULL,
      created_at      TIMESTAMP DEFAULT now(),
      UNIQUE(provider, provider_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id                 UUID REFERENCES users(id),
      stripe_customer_id      TEXT UNIQUE,
      stripe_subscription_id  TEXT UNIQUE,
      status                  TEXT NOT NULL,
      current_period_end      TIMESTAMP,
      plan_id                 TEXT
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS credit_packs (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             UUID REFERENCES users(id),
      credits_remaining   INT NOT NULL,
      purchased_at        TIMESTAMP DEFAULT now(),
      stripe_payment_id   TEXT UNIQUE
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS daily_usage (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID REFERENCES users(id),
      date        DATE NOT NULL,
      call_count  INT DEFAULT 0,
      UNIQUE(user_id, date)
    )
  `;
}

export async function findUserByProvider(provider, providerId) {
  const { rows } = await sql`
    SELECT * FROM users WHERE provider = ${provider} AND provider_id = ${providerId}
  `;
  return rows[0] || null;
}

export async function createUser({ email, name, avatarUrl, provider, providerId }) {
  const { rows } = await sql`
    INSERT INTO users (email, name, avatar_url, provider, provider_id)
    VALUES (${email}, ${name}, ${avatarUrl}, ${provider}, ${providerId})
    ON CONFLICT (provider, provider_id) DO UPDATE SET
      email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
    RETURNING *
  `;
  return rows[0];
}

export async function getSubscription(userId) {
  const { rows } = await sql`
    SELECT * FROM subscriptions WHERE user_id = ${userId} AND status = 'active'
  `;
  return rows[0] || null;
}

export async function getAvailableCredits(userId) {
  const { rows } = await sql`
    SELECT COALESCE(SUM(credits_remaining), 0) as total
    FROM credit_packs WHERE user_id = ${userId} AND credits_remaining > 0
  `;
  return parseInt(rows[0].total, 10);
}

export async function deductCredit(userId) {
  // Deduct from the oldest pack with remaining credits
  const { rowCount } = await sql`
    UPDATE credit_packs SET credits_remaining = credits_remaining - 1
    WHERE id = (
      SELECT id FROM credit_packs
      WHERE user_id = ${userId} AND credits_remaining > 0
      ORDER BY purchased_at ASC LIMIT 1
    )
  `;
  return rowCount > 0;
}

export async function getDailyUsage(userId) {
  const { rows } = await sql`
    SELECT call_count FROM daily_usage
    WHERE user_id = ${userId} AND date = CURRENT_DATE
  `;
  return rows[0]?.call_count || 0;
}

export async function incrementDailyUsage(userId) {
  await sql`
    INSERT INTO daily_usage (user_id, date, call_count)
    VALUES (${userId}, CURRENT_DATE, 1)
    ON CONFLICT (user_id, date) DO UPDATE SET call_count = daily_usage.call_count + 1
  `;
}
```

- [ ] **Step 2: Verify the file parses correctly**

```bash
node -e "import('./api/lib/db.js').then(() => console.log('Parse OK')).catch(e => console.log('Parse error:', e.message))"
```

Expected: `Parse OK` (may warn about missing env vars — that's fine, we just want syntax check)

- [ ] **Step 3: Commit**

```bash
git add api/lib/db.js
git commit -m "feat: add database client with schema init and query helpers"
```

---

### Task 3: Auth Helpers (JWT + Cookie Utilities)

**Files:**
- Create: `api/lib/auth.js`

- [ ] **Step 1: Create the auth helper module**

```js
// api/lib/auth.js
import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET_KEY = process.env.JWT_SECRET;

function getSecretKey() {
  if (!JWT_SECRET_KEY) throw new Error("JWT_SECRET env var is not set");
  return new TextEncoder().encode(JWT_SECRET_KEY);
}

export async function createSessionToken(userId) {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecretKey());
}

export async function verifySessionToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload.sub; // userId
  } catch {
    return null;
  }
}

export function setSessionCookie(res, token) {
  const maxAge = 7 * 24 * 60 * 60; // 7 days
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
  );
}

export function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
  );
}

export function getSessionCookie(req) {
  const cookies = req.headers.cookie || "";
  const match = cookies.match(/(?:^|;\s*)session=([^;]*)/);
  return match ? match[1] : null;
}

export function getOAuthStateCookie(req) {
  const cookies = req.headers.cookie || "";
  const match = cookies.match(/(?:^|;\s*)oauth_state=([^;]*)/);
  return match ? match[1] : null;
}

export function setOAuthStateCookie(res, state) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}`
  );
}

export async function getUserFromRequest(req) {
  const token = getSessionCookie(req);
  if (!token) return null;
  return verifySessionToken(token);
}
```

- [ ] **Step 2: Verify the file parses correctly**

```bash
node -e "import('./api/lib/auth.js').then(() => console.log('Parse OK')).catch(e => console.log('Parse error:', e.message))"
```

- [ ] **Step 3: Commit**

```bash
git add api/lib/auth.js
git commit -m "feat: add JWT session and cookie utilities"
```

---

### Task 4: Model Mapping Config

**Files:**
- Create: `api/lib/models.js`

- [ ] **Step 1: Create the model mapping module**

```js
// api/lib/models.js

const MODEL_MAP = {
  anthropic: {
    free: { model: "claude-haiku-4-5-20251001", url: "https://api.anthropic.com/v1/messages" },
    paid: { model: "claude-sonnet-4-6", url: "https://api.anthropic.com/v1/messages" },
  },
  openai: {
    free: { model: "gpt-4o-mini", url: "https://api.openai.com/v1/chat/completions" },
    paid: { model: "gpt-4o", url: "https://api.openai.com/v1/chat/completions" },
  },
  google: {
    free: { model: "gemini-2.0-flash-lite", baseUrl: "https://generativelanguage.googleapis.com/v1beta/models" },
    paid: { model: "gemini-2.5-pro", baseUrl: "https://generativelanguage.googleapis.com/v1beta/models" },
  },
};

// Providers that support shared-key mode
export const SHARED_KEY_PROVIDERS = ["anthropic", "openai", "google"];

export function getModelConfig(provider, tier) {
  const providerMap = MODEL_MAP[provider];
  if (!providerMap) return null;
  return providerMap[tier] || providerMap.free;
}

export function getServerApiKey(provider) {
  const keys = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
  };
  return keys[provider] || null;
}

export const FREE_DAILY_LIMIT = 20;
```

- [ ] **Step 2: Commit**

```bash
git add api/lib/models.js
git commit -m "feat: add model mapping for free/paid tiers"
```

---

### Task 5: Usage Tracking & Rate Limiting

**Files:**
- Create: `api/lib/usage.js`

- [ ] **Step 1: Create the usage/rate-limit module**

```js
// api/lib/usage.js
import { kv } from "@vercel/kv";
import { getSubscription, getAvailableCredits, deductCredit, incrementDailyUsage } from "./db.js";
import { FREE_DAILY_LIMIT } from "./models.js";

function todayKey(userId) {
  const d = new Date().toISOString().slice(0, 10);
  return `usage:${userId}:${d}`;
}

function endOfDayUTC() {
  const now = new Date();
  const eod = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.floor((eod - now) / 1000);
}

// Returns { allowed, tier, remaining, resetAt, reason }
export async function checkAndConsumeUsage(userId) {
  // 1. Check subscription
  const sub = await getSubscription(userId);
  if (sub) {
    // Paid subscriber — allow and track in KV
    const key = todayKey(userId);
    const count = (await kv.incr(key)) || 1;
    if (count === 1) await kv.expire(key, endOfDayUTC());
    // Also persist to Postgres async (best-effort)
    incrementDailyUsage(userId).catch(() => {});
    return { allowed: true, tier: "paid", remaining: null, resetAt: null };
  }

  // 2. Check credit packs
  const credits = await getAvailableCredits(userId);
  if (credits > 0) {
    await deductCredit(userId);
    return { allowed: true, tier: "paid", remaining: credits - 1, resetAt: null };
  }

  // 3. Check free daily usage
  const key = todayKey(userId);
  const currentCount = (await kv.get(key)) || 0;

  if (currentCount >= FREE_DAILY_LIMIT) {
    const resetAt = new Date();
    resetAt.setUTCHours(24, 0, 0, 0);
    return {
      allowed: false,
      tier: "free",
      remaining: 0,
      resetAt: resetAt.toISOString(),
      reason: "Daily free limit reached. Upgrade to Pro or buy a credit pack to continue.",
    };
  }

  const newCount = await kv.incr(key);
  if (newCount === 1) await kv.expire(key, endOfDayUTC());
  incrementDailyUsage(userId).catch(() => {});

  return {
    allowed: true,
    tier: "free",
    remaining: FREE_DAILY_LIMIT - newCount,
    resetAt: null,
  };
}

// Read-only: get usage info without consuming
export async function getUsageInfo(userId) {
  const sub = await getSubscription(userId);
  const credits = await getAvailableCredits(userId);
  const key = todayKey(userId);
  const dailyUsed = (await kv.get(key)) || 0;

  return {
    tier: sub ? "paid" : "free",
    subscriptionStatus: sub?.status || null,
    currentPeriodEnd: sub?.current_period_end || null,
    credits,
    dailyUsed,
    dailyLimit: sub ? null : FREE_DAILY_LIMIT,
    dailyRemaining: sub ? null : Math.max(0, FREE_DAILY_LIMIT - dailyUsed),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add api/lib/usage.js
git commit -m "feat: add usage tracking with KV cache and Postgres persistence"
```

---

### Task 6: GitHub OAuth Endpoint

**Files:**
- Create: `api/auth/github.js`

- [ ] **Step 1: Create GitHub OAuth initiation endpoint**

```js
// api/auth/github.js
import { GitHub } from "arctic";
import { setOAuthStateCookie } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const github = new GitHub(
    process.env.GITHUB_CLIENT_ID,
    process.env.GITHUB_CLIENT_SECRET,
    process.env.OAUTH_REDIRECT_URL + "?provider=github"
  );

  const state = crypto.randomUUID();
  const url = github.createAuthorizationURL(state, ["user:email"]);

  setOAuthStateCookie(res, state);
  res.writeHead(302, { Location: url.toString() });
  res.end();
}
```

- [ ] **Step 2: Commit**

```bash
git add api/auth/github.js
git commit -m "feat: add GitHub OAuth initiation endpoint"
```

---

### Task 7: Google OAuth Endpoint

**Files:**
- Create: `api/auth/google.js`

- [ ] **Step 1: Create Google OAuth initiation endpoint**

```js
// api/auth/google.js
import { Google } from "arctic";
import { setOAuthStateCookie } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const google = new Google(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.OAUTH_REDIRECT_URL + "?provider=google"
  );

  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomUUID() + crypto.randomUUID();
  const url = google.createAuthorizationURL(state, codeVerifier, ["openid", "email", "profile"]);

  // Store both state and codeVerifier in cookie (needed for PKCE)
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", [
    `oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}`,
    `oauth_verifier=${codeVerifier}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}`,
  ]);

  res.writeHead(302, { Location: url.toString() });
  res.end();
}
```

- [ ] **Step 2: Commit**

```bash
git add api/auth/google.js
git commit -m "feat: add Google OAuth initiation endpoint"
```

---

### Task 8: OAuth Callback Handler

**Files:**
- Create: `api/auth/callback.js`

- [ ] **Step 1: Create the unified OAuth callback**

```js
// api/auth/callback.js
import { GitHub, Google } from "arctic";
import { createUser } from "../lib/db.js";
import { createSessionToken, setSessionCookie, getOAuthStateCookie } from "../lib/auth.js";

function getCookie(req, name) {
  const cookies = req.headers.cookie || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

async function handleGitHub(code) {
  const github = new GitHub(
    process.env.GITHUB_CLIENT_ID,
    process.env.GITHUB_CLIENT_SECRET,
    process.env.OAUTH_REDIRECT_URL + "?provider=github"
  );

  const tokens = await github.validateAuthorizationCode(code);
  const accessToken = tokens.accessToken();

  const [userRes, emailsRes] = await Promise.all([
    fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "annotator" },
    }),
    fetch("https://api.github.com/user/emails", {
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "annotator" },
    }),
  ]);

  const userData = await userRes.json();
  const emails = await emailsRes.json();
  const primaryEmail = emails.find((e) => e.primary)?.email || emails[0]?.email || `${userData.id}@github.noreply`;

  return {
    email: primaryEmail,
    name: userData.name || userData.login,
    avatarUrl: userData.avatar_url,
    provider: "github",
    providerId: String(userData.id),
  };
}

async function handleGoogle(code, codeVerifier) {
  const google = new Google(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.OAUTH_REDIRECT_URL + "?provider=google"
  );

  const tokens = await google.validateAuthorizationCode(code, codeVerifier);
  const accessToken = tokens.accessToken();

  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();

  return {
    email: data.email,
    name: data.name,
    avatarUrl: data.picture,
    provider: "google",
    providerId: String(data.id),
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { code, state, provider } = req.query;
  const storedState = getOAuthStateCookie(req);

  if (!code || !state || !storedState || state !== storedState) {
    return res.status(400).json({ error: "Invalid OAuth state" });
  }

  try {
    let profile;
    if (provider === "github") {
      profile = await handleGitHub(code);
    } else if (provider === "google") {
      const codeVerifier = getCookie(req, "oauth_verifier");
      if (!codeVerifier) return res.status(400).json({ error: "Missing OAuth verifier" });
      profile = await handleGoogle(code, codeVerifier);
    } else {
      return res.status(400).json({ error: "Unknown provider" });
    }

    const user = await createUser(profile);
    const token = await createSessionToken(user.id);
    setSessionCookie(res, token);

    // Redirect back to app
    res.writeHead(302, { Location: "/" });
    res.end();
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.writeHead(302, { Location: "/?auth_error=1" });
    res.end();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/auth/callback.js
git commit -m "feat: add unified OAuth callback for GitHub and Google"
```

---

### Task 9: Session & Logout Endpoints

**Files:**
- Create: `api/auth/session.js`
- Create: `api/auth/logout.js`

- [ ] **Step 1: Create session endpoint**

```js
// api/auth/session.js
import { getUserFromRequest } from "../lib/auth.js";
import { sql } from "../lib/db.js";
import { getUsageInfo } from "../lib/usage.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const userId = await getUserFromRequest(req);
  if (!userId) return res.status(200).json({ user: null });

  const { rows } = await sql`SELECT id, email, name, avatar_url FROM users WHERE id = ${userId}`;
  const user = rows[0];
  if (!user) return res.status(200).json({ user: null });

  const usage = await getUsageInfo(userId);

  return res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
    },
    usage,
  });
}
```

- [ ] **Step 2: Create logout endpoint**

```js
// api/auth/logout.js
import { clearSessionCookie } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add api/auth/session.js api/auth/logout.js
git commit -m "feat: add session info and logout endpoints"
```

---

### Task 10: Stripe Checkout Endpoint

**Files:**
- Create: `api/stripe/checkout.js`

- [ ] **Step 1: Create Stripe checkout endpoint**

```js
// api/stripe/checkout.js
import Stripe from "stripe";
import { getUserFromRequest } from "../lib/auth.js";
import { sql } from "../lib/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const userId = await getUserFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const { type } = req.body; // "subscription" or "credits"

  // Find or create Stripe customer
  const { rows } = await sql`SELECT email FROM users WHERE id = ${userId}`;
  const user = rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });

  const { rows: subRows } = await sql`
    SELECT stripe_customer_id FROM subscriptions WHERE user_id = ${userId}
  `;
  let customerId = subRows[0]?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { user_id: userId },
    });
    customerId = customer.id;
  }

  const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, "") || process.env.APP_URL;

  let sessionConfig;
  if (type === "subscription") {
    sessionConfig = {
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
      metadata: { user_id: userId },
    };
  } else if (type === "credits") {
    sessionConfig = {
      customer: customerId,
      mode: "payment",
      line_items: [{ price: process.env.STRIPE_CREDITS_PRICE_ID, quantity: 1 }],
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
      metadata: { user_id: userId, type: "credits" },
    };
  } else {
    return res.status(400).json({ error: "Invalid checkout type. Use 'subscription' or 'credits'." });
  }

  const session = await stripe.checkout.sessions.create(sessionConfig);
  return res.status(200).json({ url: session.url });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/stripe/checkout.js
git commit -m "feat: add Stripe checkout endpoint for subscriptions and credit packs"
```

---

### Task 11: Stripe Portal Endpoint

**Files:**
- Create: `api/stripe/portal.js`

- [ ] **Step 1: Create Stripe customer portal endpoint**

```js
// api/stripe/portal.js
import Stripe from "stripe";
import { getUserFromRequest } from "../lib/auth.js";
import { sql } from "../lib/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const userId = await getUserFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const { rows } = await sql`
    SELECT stripe_customer_id FROM subscriptions WHERE user_id = ${userId}
  `;
  const customerId = rows[0]?.stripe_customer_id;
  if (!customerId) return res.status(404).json({ error: "No subscription found" });

  const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, "") || process.env.APP_URL;
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: origin,
  });

  return res.status(200).json({ url: session.url });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/stripe/portal.js
git commit -m "feat: add Stripe customer portal endpoint"
```

---

### Task 12: Stripe Webhook Handler

**Files:**
- Create: `api/stripe/webhook.js`

- [ ] **Step 1: Create the webhook handler**

```js
// api/stripe/webhook.js
import Stripe from "stripe";
import { sql } from "../lib/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Vercel: disable body parsing so we get the raw body for signature verification
export const config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const rawBody = await getRawBody(req);
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = session.metadata.user_id;

      if (session.mode === "subscription") {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        await sql`
          INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, plan_id)
          VALUES (${userId}, ${session.customer}, ${session.subscription}, 'active',
                  ${new Date(subscription.current_period_end * 1000).toISOString()}, 'pro')
          ON CONFLICT (stripe_subscription_id) DO UPDATE SET
            status = 'active',
            current_period_end = ${new Date(subscription.current_period_end * 1000).toISOString()}
        `;
      } else if (session.metadata.type === "credits") {
        const creditsAmount = parseInt(process.env.CREDITS_PACK_AMOUNT || "100", 10);
        await sql`
          INSERT INTO credit_packs (user_id, credits_remaining, stripe_payment_id)
          VALUES (${userId}, ${creditsAmount}, ${session.payment_intent})
        `;
      }
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object;
      if (invoice.subscription) {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        await sql`
          UPDATE subscriptions SET
            status = 'active',
            current_period_end = ${new Date(subscription.current_period_end * 1000).toISOString()}
          WHERE stripe_subscription_id = ${invoice.subscription}
        `;
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      await sql`
        UPDATE subscriptions SET status = 'canceled'
        WHERE stripe_subscription_id = ${subscription.id}
      `;
      break;
    }
  }

  return res.status(200).json({ received: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/stripe/webhook.js
git commit -m "feat: add Stripe webhook handler for subscriptions and credits"
```

---

### Task 13: Upgrade `/api/chat.js` — Auth-Aware Proxy with Rate Limiting

**Files:**
- Modify: `api/chat.js:1-31`

- [ ] **Step 1: Replace the existing chat proxy with the auth-aware gatekeeper**

Replace the entire contents of `api/chat.js` with:

```js
// api/chat.js — Auth-aware AI proxy with rate limiting and model gating
import { getUserFromRequest } from "./lib/auth.js";
import { checkAndConsumeUsage } from "./lib/usage.js";
import { getModelConfig, getServerApiKey, SHARED_KEY_PROVIDERS } from "./lib/models.js";

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { url, headers, body, provider, useSharedKey } = req.body;

  // === BYOK mode: user provides their own API key ===
  if (!useSharedKey) {
    if (!url) return res.status(400).json({ error: "Missing url" });
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: headers || { "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      const data = await response.json();
      return res.status(response.status).json(data);
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  // === Shared-key mode: authenticate, rate-limit, and proxy ===
  const userId = await getUserFromRequest(req);
  if (!userId) {
    return res.status(401).json({ error: "Sign in to use shared AI access." });
  }

  if (!provider || !SHARED_KEY_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `Shared key not available for provider: ${provider}. Use your own API key.` });
  }

  // Rate limit check
  const usage = await checkAndConsumeUsage(userId);
  if (!usage.allowed) {
    res.setHeader("X-RateLimit-Remaining", "0");
    res.setHeader("X-RateLimit-Reset", usage.resetAt);
    return res.status(429).json({ error: usage.reason });
  }

  // Set rate limit headers
  if (usage.remaining !== null) {
    res.setHeader("X-RateLimit-Remaining", String(usage.remaining));
  }

  // Get model and API key for this tier
  const modelConfig = getModelConfig(provider, usage.tier);
  const apiKey = getServerApiKey(provider);
  if (!apiKey) {
    return res.status(500).json({ error: `Server API key not configured for ${provider}.` });
  }

  // Build the proxied request based on provider
  try {
    let proxyUrl, proxyHeaders, proxyBody;

    if (provider === "anthropic") {
      proxyUrl = modelConfig.url;
      proxyHeaders = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      };
      proxyBody = { ...body, model: modelConfig.model };
    } else if (provider === "openai") {
      proxyUrl = modelConfig.url;
      proxyHeaders = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };
      proxyBody = { ...body, model: modelConfig.model };
    } else if (provider === "google") {
      proxyUrl = `${modelConfig.baseUrl}/${modelConfig.model}:generateContent?key=${apiKey}`;
      proxyHeaders = { "Content-Type": "application/json" };
      proxyBody = body; // Google model is in the URL, not the body
    }

    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: proxyHeaders,
      body: JSON.stringify(proxyBody),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
```

- [ ] **Step 2: Verify the file parses correctly**

```bash
node -e "import('./api/chat.js').then(() => console.log('Parse OK')).catch(e => console.log('Parse error:', e.message))"
```

- [ ] **Step 3: Commit**

```bash
git add api/chat.js
git commit -m "feat: upgrade chat proxy with auth, rate limiting, and model gating"
```

---

### Task 14: Database Schema Initialization Endpoint

**Files:**
- Create: `api/init-db.js`

This is a one-time endpoint to run schema migrations. Call it once after setting up Vercel Postgres, then optionally remove or protect it.

- [ ] **Step 1: Create the init endpoint**

```js
// api/init-db.js
import { initSchema } from "./lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Simple secret check to prevent public access
  const secret = req.headers["x-init-secret"];
  if (secret !== process.env.DB_INIT_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    await initSchema();
    return res.status(200).json({ ok: true, message: "Schema initialized" });
  } catch (err) {
    console.error("Schema init error:", err);
    return res.status(500).json({ error: err.message });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/init-db.js
git commit -m "feat: add one-time database schema initialization endpoint"
```

---

### Task 15: Client-Side Auth State & Session Fetching

**Files:**
- Modify: `src/Annotator.jsx:443-453` (state declarations area)

- [ ] **Step 1: Add auth state variables**

After the existing state declarations around line 443, add new state for auth:

```js
// Add after line 453 (after showHotkeySettings state)
const [currentUser, setCurrentUser] = useState(null);
const [authLoading, setAuthLoading] = useState(true);
const [useSharedKey, setUseSharedKey] = useState(() => {
  try { return JSON.parse(localStorage.getItem("annotator_use_shared_key")); } catch { return null; }
});
const [usageInfo, setUsageInfo] = useState(null);
const [showUpgradeModal, setShowUpgradeModal] = useState(false);
const [showUserMenu, setShowUserMenu] = useState(false);
```

- [ ] **Step 2: Add session fetch effect**

Add a `useEffect` to fetch the session on mount. Place it after the existing `useEffect` blocks (after the hotkey handler effect):

```js
// Session fetch on mount
useEffect(() => {
  if (!IS_DEPLOYED) { setAuthLoading(false); return; }
  fetch("/api/auth/session")
    .then(r => r.json())
    .then(data => {
      setCurrentUser(data.user);
      setUsageInfo(data.usage);
      // Auto-enable shared key for new sign-ins if no BYOK settings exist
      if (data.user && useSharedKey === null) {
        const hasOwnKey = loadAISettings()?.apiKey;
        if (!hasOwnKey) {
          setUseSharedKey(true);
          localStorage.setItem("annotator_use_shared_key", "true");
        }
      }
    })
    .catch(() => {})
    .finally(() => setAuthLoading(false));
}, []);
```

- [ ] **Step 3: Commit**

```bash
git add src/Annotator.jsx
git commit -m "feat: add client-side auth state and session fetching"
```

---

### Task 16: Modify `aiFetch` to Support Shared Key Mode

**Files:**
- Modify: `src/Annotator.jsx:183-191` (aiFetch function)

- [ ] **Step 1: Update aiFetch to pass shared-key flag and provider**

Replace the current `aiFetch` function (lines 183-191) with:

```js
async function aiFetch(url, options, { useSharedKey: shared, provider } = {}) {
  if (!IS_DEPLOYED) return fetch(url, options);
  const payload = { url, headers: options.headers, body: JSON.parse(options.body) };
  if (shared) {
    payload.useSharedKey = true;
    payload.provider = provider;
  }
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return res;
}
```

- [ ] **Step 2: Update `callAI` to pass shared-key context through**

In `callAI` (around line 248), the individual provider call functions need the shared-key context. Modify `callAI` to accept and forward a `sharedKeyOpts` parameter:

Replace the `callAI` function (lines 248-272) with:

```js
async function callAI(settings, { messages, highlightedText, fullDoc, useContext, useWebSearch, linkedContext, attachments }, sharedKeyOpts) {
  if (!settings?.provider) throw new Error("No AI provider configured — open Settings (gear icon) to set up.");

  const ctx = useContext ? (fullDoc.length > 6000 ? fullDoc.slice(0, 6000) + "\n…[truncated]" : fullDoc) : "";
  const system = [
    "You are a reading assistant. The user highlighted this passage:",
    `"${highlightedText}"`,
    useContext && ctx ? `\nFull document context:\n${ctx}` : "",
    linkedContext ? `\nLinked annotation context:\n${linkedContext}` : "",
    attachments?.length ? `\nAttached files:\n${attachments.map(a => `--- ${a.name} ---\n${a.content.slice(0, 4000)}`).join("\n\n")}` : "",
    "\nAnswer clearly and concisely (2-5 sentences unless more is needed).",
  ].filter(Boolean).join("\n");

  const { provider, apiKey, model, baseUrl } = settings;
  const prov = PROVIDERS.find(p => p.id === provider);
  const fetchOpts = sharedKeyOpts ? { useSharedKey: true, provider } : {};

  if (provider === "anthropic") return callAnthropic(apiKey, model, messages, system, useWebSearch && prov?.supportsSearch, fetchOpts);
  if (provider === "google") return callGemini(apiKey, model, messages, system, fetchOpts);

  // OpenAI, OpenRouter, Ollama, Custom — all OpenAI-compatible
  const url = provider === "openai" ? "https://api.openai.com"
    : provider === "openrouter" ? "https://openrouter.ai/api"
    : baseUrl || prov?.defaultUrl || "http://localhost:11434";
  return callOpenAICompat(url, apiKey, model, messages, system, fetchOpts);
}
```

- [ ] **Step 3: Update `callAnthropic` to accept and forward fetchOpts**

Replace `callAnthropic` (lines 193-210) with:

```js
async function callAnthropic(apiKey, model, messages, system, useWebSearch, fetchOpts = {}) {
  const body = { model, max_tokens: 1000, system, messages };
  if (useWebSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
  if (!IS_DEPLOYED) headers["anthropic-dangerous-direct-browser-access"] = "true";
  const res = await aiFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }, fetchOpts);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "No response.";
}
```

- [ ] **Step 4: Update `callOpenAICompat` to accept and forward fetchOpts**

Replace `callOpenAICompat` (lines 212-224) with:

```js
async function callOpenAICompat(baseUrl, apiKey, model, messages, system, fetchOpts = {}) {
  const allMessages = [{ role: "system", content: system }, ...messages];
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await aiFetch(`${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages: allMessages, max_tokens: 1000 }),
  }, fetchOpts);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices?.[0]?.message?.content || "No response.";
}
```

- [ ] **Step 5: Update `callGemini` to accept and forward fetchOpts**

Replace `callGemini` (lines 226-246) with:

```js
async function callGemini(apiKey, model, messages, system, fetchOpts = {}) {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const res = await aiFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: 1000 },
      }),
    },
    fetchOpts,
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "No response.";
}
```

- [ ] **Step 6: Update callAI call sites to pass sharedKeyOpts**

There are two places in `Annotator.jsx` where `callAI` is called (around lines 820 and 872). Both need to pass the shared-key context. These calls happen inside the component, so they have access to `useSharedKey` state.

At line ~820, change:
```js
const answer = await callAI(aiSettings, { messages: apiMessages, highlightedText: anno.text, fullDoc: doc, useContext: withContext, useWebSearch: doWebSearch, linkedContext: linked, attachments });
```
to:
```js
const answer = await callAI(aiSettings, { messages: apiMessages, highlightedText: anno.text, fullDoc: doc, useContext: withContext, useWebSearch: doWebSearch, linkedContext: linked, attachments }, useSharedKey ? { useSharedKey: true } : undefined);
```

At line ~872, change:
```js
const answer = await callAI(aiSettings, { messages: apiMessages, highlightedText: anno.text, fullDoc: doc, useContext: editedMsg.withContext || false, useWebSearch: false });
```
to:
```js
const answer = await callAI(aiSettings, { messages: apiMessages, highlightedText: anno.text, fullDoc: doc, useContext: editedMsg.withContext || false, useWebSearch: false }, useSharedKey ? { useSharedKey: true } : undefined);
```

- [ ] **Step 7: Handle 429 rate-limit errors in callAI call sites**

In both call sites (lines ~820 and ~872), the existing `catch` blocks show errors. Add a check for rate-limit errors so the UI can show the upgrade prompt. In the catch block after each `callAI` call, add logic to detect 429:

In the error message handler, check if the error message contains "Daily free limit" and if so, surface the upgrade option. This is handled naturally since the server returns the error message and the existing UI already shows `err.message` to the user. The upgrade button is added in Task 18.

- [ ] **Step 8: Commit**

```bash
git add src/Annotator.jsx
git commit -m "feat: wire shared-key mode through AI call chain"
```

---

### Task 17: Auth UI in Header

**Files:**
- Modify: `src/Annotator.jsx:1260-1269` (header buttons area)

- [ ] **Step 1: Add sign-in button and user avatar dropdown**

Before the settings button (line 1260), insert the auth UI:

```jsx
{/* Auth UI */}
{IS_DEPLOYED && !authLoading && (
  currentUser ? (
    <div style={{ position: "relative" }}>
      <button onClick={() => setShowUserMenu(v => !v)}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 7, border: "1px solid #d4d0c8", background: "transparent", cursor: "pointer", fontFamily: MONO, fontSize: 11 }}>
        {currentUser.avatarUrl ? (
          <img src={currentUser.avatarUrl} alt="" style={{ width: 20, height: 20, borderRadius: "50%" }} />
        ) : (
          <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#e5e2dc", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>
            {currentUser.name?.[0]?.toUpperCase() || "?"}
          </span>
        )}
        <span>{currentUser.name?.split(" ")[0] || "Account"}</span>
      </button>
      {showUserMenu && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, background: "#fff", border: "1px solid #e5e2dc", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.08)", minWidth: 200, zIndex: 1000, fontFamily: MONO, fontSize: 11 }}
          onClick={() => setShowUserMenu(false)}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #f0ede8", opacity: 0.6 }}>
            {currentUser.email}
          </div>
          {usageInfo && (
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #f0ede8" }}>
              {usageInfo.tier === "paid" ? (
                <span>Pro — {usageInfo.dailyUsed} calls today</span>
              ) : (
                <span>{usageInfo.dailyRemaining}/{usageInfo.dailyLimit} free calls left</span>
              )}
              {usageInfo.credits > 0 && <div style={{ marginTop: 4 }}>{usageInfo.credits} credits remaining</div>}
            </div>
          )}
          {usageInfo?.tier !== "paid" && (
            <button onClick={() => setShowUpgradeModal(true)}
              style={{ display: "block", width: "100%", padding: "10px 14px", border: "none", background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: MONO, fontSize: 11, color: "#f59e0b", fontWeight: 600, borderBottom: "1px solid #f0ede8" }}
              onMouseEnter={e => e.target.style.background = "#f7f6f3"} onMouseLeave={e => e.target.style.background = "transparent"}>
              Upgrade to Pro
            </button>
          )}
          {usageInfo?.subscriptionStatus === "active" && (
            <button onClick={async () => {
              const r = await fetch("/api/stripe/portal", { method: "POST", credentials: "include" });
              const { url } = await r.json();
              if (url) window.location.href = url;
            }}
              style={{ display: "block", width: "100%", padding: "10px 14px", border: "none", background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: MONO, fontSize: 11, borderBottom: "1px solid #f0ede8" }}
              onMouseEnter={e => e.target.style.background = "#f7f6f3"} onMouseLeave={e => e.target.style.background = "transparent"}>
              Manage Subscription
            </button>
          )}
          <button onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
            setCurrentUser(null);
            setUsageInfo(null);
            setUseSharedKey(false);
            localStorage.removeItem("annotator_use_shared_key");
          }}
            style={{ display: "block", width: "100%", padding: "10px 14px", border: "none", background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: MONO, fontSize: 11 }}
            onMouseEnter={e => e.target.style.background = "#f7f6f3"} onMouseLeave={e => e.target.style.background = "transparent"}>
            Sign Out
          </button>
        </div>
      )}
    </div>
  ) : (
    <div style={{ position: "relative" }}>
      <button onClick={() => setShowUserMenu(v => !v)}
        style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #10B981", background: "#D1FAE5", cursor: "pointer", fontFamily: MONO, fontSize: 11, color: "#065F46" }}>
        Sign In
      </button>
      {showUserMenu && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, background: "#fff", border: "1px solid #e5e2dc", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.08)", minWidth: 180, zIndex: 1000, fontFamily: MONO, fontSize: 11 }}
          onClick={() => setShowUserMenu(false)}>
          <a href="/api/auth/github"
            style={{ display: "block", padding: "10px 14px", textDecoration: "none", color: "#1a1a1a", borderBottom: "1px solid #f0ede8" }}
            onMouseEnter={e => e.target.style.background = "#f7f6f3"} onMouseLeave={e => e.target.style.background = "transparent"}>
            Continue with GitHub
          </a>
          <a href="/api/auth/google"
            style={{ display: "block", padding: "10px 14px", textDecoration: "none", color: "#1a1a1a" }}
            onMouseEnter={e => e.target.style.background = "#f7f6f3"} onMouseLeave={e => e.target.style.background = "transparent"}>
            Continue with Google
          </a>
        </div>
      )}
    </div>
  )
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/Annotator.jsx
git commit -m "feat: add auth UI with sign-in, user menu, and usage display"
```

---

### Task 18: Shared Key Toggle in Settings & Upgrade Modal

**Files:**
- Modify: `src/Annotator.jsx:1280-1290` (settings modal, top of form)
- Modify: `src/Annotator.jsx` (after settings modal, add upgrade modal)

- [ ] **Step 1: Add shared-key toggle at top of settings modal**

Inside the settings modal, right after the `<h2>AI Provider Settings</h2>` header (around line 1280), insert a toggle when the user is signed in:

```jsx
{currentUser && IS_DEPLOYED && (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #f0ede8", marginBottom: 12 }}>
    <label style={{ fontFamily: MONO, fontSize: 11, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
      <input type="checkbox" checked={useSharedKey || false}
        onChange={e => {
          setUseSharedKey(e.target.checked);
          localStorage.setItem("annotator_use_shared_key", JSON.stringify(e.target.checked));
        }} />
      Use shared AI key (no API key needed)
    </label>
    {useSharedKey && usageInfo && (
      <span style={{ fontFamily: MONO, fontSize: 10, opacity: 0.6 }}>
        {usageInfo.tier === "paid" ? "Pro" : `${usageInfo.dailyRemaining}/${usageInfo.dailyLimit} free`}
      </span>
    )}
  </div>
)}
```

- [ ] **Step 2: Hide API key fields when shared key is active**

Wrap the existing API key input section (around line 1294-1299) with a condition:

```jsx
{(!useSharedKey || !currentUser) && PROVIDERS.find(p => p.id === settingsDraft.provider)?.needsKey && (
  // ... existing API key input ...
)}
```

- [ ] **Step 3: Add the upgrade modal**

After the settings modal closing `</div>`, add:

```jsx
{showUpgradeModal && (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}
    onClick={() => setShowUpgradeModal(false)}>
    <div style={{ background: "#fff", borderRadius: 12, padding: 28, maxWidth: 420, width: "90%", fontFamily: FONT }}
      onClick={e => e.stopPropagation()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Upgrade</h2>
        <button onClick={() => setShowUpgradeModal(false)} style={{ border: "none", background: "transparent", fontSize: 16, cursor: "pointer", opacity: 0.4 }}>✕</button>
      </div>

      <div style={{ border: "1px solid #e5e2dc", borderRadius: 8, padding: 16, marginBottom: 12 }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 14, fontFamily: MONO }}>Pro Plan</h3>
        <p style={{ margin: "0 0 10px", fontSize: 13, opacity: 0.7 }}>Premium AI models, higher daily limits</p>
        <button onClick={async () => {
          const r = await fetch("/api/stripe/checkout", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "subscription" }),
          });
          const { url } = await r.json();
          if (url) window.location.href = url;
        }}
          style={{ width: "100%", padding: "10px", borderRadius: 7, border: "none", background: "#1a1a1a", color: "#fff", cursor: "pointer", fontFamily: MONO, fontSize: 12 }}>
          Subscribe
        </button>
      </div>

      <div style={{ border: "1px solid #e5e2dc", borderRadius: 8, padding: 16 }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 14, fontFamily: MONO }}>Credit Pack</h3>
        <p style={{ margin: "0 0 10px", fontSize: 13, opacity: 0.7 }}>100 premium AI calls, no expiry</p>
        <button onClick={async () => {
          const r = await fetch("/api/stripe/checkout", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "credits" }),
          });
          const { url } = await r.json();
          if (url) window.location.href = url;
        }}
          style={{ width: "100%", padding: "10px", borderRadius: 7, border: "none", background: "#f59e0b", color: "#92400E", cursor: "pointer", fontFamily: MONO, fontSize: 12 }}>
          Buy Credits
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Add sign-in banner for unauthenticated users**

After the header `</div>` (line ~1271), add a subtle banner when deployed and not signed in:

```jsx
{IS_DEPLOYED && !authLoading && !currentUser && (
  <div style={{ background: "#D1FAE5", padding: "6px 16px", fontFamily: MONO, fontSize: 11, textAlign: "center", color: "#065F46", borderBottom: "1px solid #A7F3D0" }}>
    Sign in for free AI calls — no API key needed
  </div>
)}
```

- [ ] **Step 5: Commit**

```bash
git add src/Annotator.jsx
git commit -m "feat: add shared-key toggle, upgrade modal, and sign-in banner"
```

---

### Task 19: Refresh Usage After AI Calls

**Files:**
- Modify: `src/Annotator.jsx` (after each callAI success, around lines 820-821 and 872-873)

- [ ] **Step 1: Create a usage refresh helper**

Add this function inside the `Annotator` component (after the state declarations):

```js
const refreshUsage = useCallback(() => {
  if (!IS_DEPLOYED || !currentUser) return;
  fetch("/api/auth/session", { credentials: "include" })
    .then(r => r.json())
    .then(data => { if (data.usage) setUsageInfo(data.usage); })
    .catch(() => {});
}, [currentUser]);
```

- [ ] **Step 2: Call refreshUsage after each AI call**

After the `callAI` success on line ~821 (after `const aiName = ...`), add:

```js
if (useSharedKey) refreshUsage();
```

After the `callAI` success on line ~873 (after `const aiName = ...`), add the same:

```js
if (useSharedKey) refreshUsage();
```

- [ ] **Step 3: Show upgrade prompt on rate limit error**

In both error handlers for `callAI` calls, add a check:

```js
if (err.message?.includes("Daily free limit") || err.message?.includes("Upgrade")) {
  setShowUpgradeModal(true);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/Annotator.jsx
git commit -m "feat: refresh usage display after AI calls and show upgrade on limit"
```

---

### Task 20: Environment Variables Documentation

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create env example file**

```bash
# .env.example — Required environment variables for tiered AI access

# Database (Vercel Postgres — auto-set when you link the addon)
POSTGRES_URL=

# KV Store (Vercel KV — auto-set when you link the addon)
KV_REST_API_URL=
KV_REST_API_TOKEN=

# JWT secret for session tokens (generate a random 64-char string)
JWT_SECRET=

# OAuth: GitHub (https://github.com/settings/developers)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# OAuth: Google (https://console.cloud.google.com/apis/credentials)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=

# OAuth redirect URL (must match what's set in GitHub/Google console)
OAUTH_REDIRECT_URL=https://your-app.vercel.app/api/auth/callback

# Stripe (https://dashboard.stripe.com/apikeys)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=
STRIPE_CREDITS_PRICE_ID=

# Credit pack size
CREDITS_PACK_AMOUNT=100

# Server-side AI provider API keys
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=

# DB init secret (for one-time schema creation)
DB_INIT_SECRET=

# App URL (fallback for Stripe redirects)
APP_URL=https://your-app.vercel.app
```

- [ ] **Step 2: Add `.env` to `.gitignore` if not already there**

Check `.gitignore` for `.env` — if missing, add it.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: add environment variables example for tiered AI access"
```

---

### Task 21: Vercel Configuration Update

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Ensure API routes are handled correctly**

The current `vercel.json` already rewrites `/api/(.*)` to `/api/$1`, which covers the new nested routes (`/api/auth/github`, `/api/stripe/checkout`, etc.). Verify this works with nested directories by checking that Vercel's file-based routing resolves `api/auth/github.js` from a request to `/api/auth/github`.

No changes should be needed — Vercel's default serverless function routing handles nested directories. But verify after deployment.

- [ ] **Step 2: Commit (only if changes were needed)**

---

### Task 22: End-to-End Smoke Test

- [ ] **Step 1: Set up Vercel Postgres**

Via Vercel dashboard or CLI: create a Postgres database and link it to the project. This auto-sets `POSTGRES_URL`.

- [ ] **Step 2: Set up Vercel KV**

Via Vercel dashboard or CLI: create a KV store and link it. This auto-sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.

- [ ] **Step 3: Set environment variables**

Add all variables from `.env.example` to the Vercel project settings.

- [ ] **Step 4: Initialize the database schema**

```bash
curl -X POST https://your-app.vercel.app/api/init-db -H "x-init-secret: YOUR_DB_INIT_SECRET"
```

Expected: `{"ok":true,"message":"Schema initialized"}`

- [ ] **Step 5: Test OAuth flow**

1. Visit the deployed app
2. Click "Sign In" → "Continue with GitHub"
3. Authorize the app
4. Verify redirect back to app with user avatar showing

- [ ] **Step 6: Test free tier AI call**

1. While signed in, toggle "Use shared AI key" in settings
2. Select Anthropic provider
3. Create a highlight and send a message
4. Verify the AI responds (using Haiku, the free-tier model)
5. Check user menu — usage count should show 1/20

- [ ] **Step 7: Test rate limit**

Verify that after 20 calls, the API returns 429 and the upgrade modal appears.

- [ ] **Step 8: Test BYOK mode**

1. Uncheck "Use shared AI key"
2. Enter your own API key
3. Verify AI calls work without metering (same as before)

- [ ] **Step 9: Test Stripe checkout**

1. Click "Upgrade to Pro" in the user menu
2. Verify redirect to Stripe Checkout
3. Complete a test payment (use Stripe test mode)
4. Verify redirect back to app with "Pro" tier showing

- [ ] **Step 10: Commit any fixes from smoke testing**

```bash
git add -A
git commit -m "fix: smoke test fixes for tiered AI access"
```
