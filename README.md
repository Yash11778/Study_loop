# Study Loop

Login → onboarding → notes → Q&A → quiz → result.

The questions a student asks during Q&A are tagged to concepts and scored into a
per-concept struggle profile. That profile — not a generic prompt — is what the
quiz is generated from, so the ten questions land on the gaps the student
actually revealed.

## Layout

```
project/
├── shared/     @study-loop/shared — Zod contracts + domain vocabulary
├── backend/    Node + Express 5 API. Owns Mongo, inference, email.
├── frontend/   Next.js 16 (App Router). UI only; no database access.
├── render.yaml Blueprint for the API
└── vercel.json Build + cron config for the web app
```

`shared/` is why the two sides cannot drift: the backend validates request
bodies with the same Zod objects the frontend derives its types from.

### backend/src

```
config/       env validation (fails at boot), model ids + provider chains
db/           connection caching, typed model helper
models/       Mongoose schemas
services/     business logic — ai/, auth, qna, blueprint, quiz, result, email, seed
controllers/  thin HTTP handlers, no logic
routes/       route tables + middleware wiring
middleware/   auth, validation, rate limiting, error shaping
utils/        errors, logger, chunking, http helpers
scripts/      seed, indexes, doctor, e2e
```

### frontend/src

```
app/          App Router pages — /, /onboarding, /study, /quiz/[id], /results/[id]
components/   AppShell, Markdown, ui/ primitives
lib/          api-client (the only fetch), api (typed endpoints), session, use-guard
styles/
```

## Local setup

```bash
npm install
cp backend/.env.example  backend/.env
cp frontend/.env.example frontend/.env.local
```

Fill in `backend/.env`, then check every external service before writing code:

```bash
npm run doctor
```

It reports each dependency separately, which separates "my code is wrong" from
"that credential is wrong". Then:

```bash
npm run build --workspace=shared   # backend + frontend import its built output
npm run seed                       # authors, chunks and embeds the physics note
npm run indexes                    # syncs indexes, prints the Atlas vector index JSON
npm run dev                        # API on :4000, web on :3000
```

### MongoDB must be Atlas

Not a local single-node `mongod`. The seed writes in a transaction (needs a
replica set) and retrieval uses Atlas Vector Search.

`npm run indexes` prints a vector index definition you must create by hand in
**Atlas → Atlas Search → Create Index → JSON editor**. It is not a driver-side
index, so Mongoose cannot create it. Until it exists, retrieval falls back to
exact in-process cosine scoring — correct, and fine at seed scale.

### Verifying it works

Three checks, cheapest first.

```bash
npm run doctor          # every external service, independently
npm run e2e             # the API loop, against a throwaway replica set
npm run browser-check   # the whole journey in a real Chromium
```

`doctor` reports each dependency separately, which separates "my code is wrong"
from "that credential is wrong". It also checks the configured model ids against
what your accounts can actually see.

`e2e` runs seed → sign in → onboarding → three Q&A turns → quiz → submit →
result → email against an in-memory replica set, asserting along the way that
the answer key never appears in a client payload.

`browser-check` starts both servers, drives the full journey in Chrome, and
**fails on any console error, failed request, or 4xx/5xx**. It writes
`browser-check.png` so you can see the final screen. Both of the last two make
real Groq and Gemini calls, so they cost quota and take a couple of minutes.

## Authentication

Two factors, in order:

1. **`POST /api/auth/register`** or **`/login`** — email and password. Passwords
   are `scrypt` hashes (Node's standard library, so there is no native module to
   build on the deploy host), stored `select: false` so a query has to ask for
   them explicitly. Neither endpoint issues a session.
2. **`POST /api/auth/verify`** — the six-digit emailed code. Only this issues the
   session cookie.

A correct password on its own gets nothing, which the browser check asserts by
calling `/auth/me` between the two steps and requiring a 401. Wrong email and
wrong password return the same message so the endpoint cannot be used to
discover which addresses have accounts, and a missing account still pays the
cost of a hash so response timing does not leak it either.

## Progress

Progress is stored against the account, not the browser session.

`POST /api/qna/sessions` resumes a student's open session for a topic rather
than starting a new one — enforced by a unique partial index on
`{ userId, noteId }` where `active: true`. Sign out and back in and the Q&A
thread, the concepts covered and the struggle signals the quiz is built from are
all still there. `GET /api/progress` returns per-topic counts, best and last
score, all derived from the underlying turns and attempts rather than kept in a
separate counter that could drift.

Indexes are never built implicitly: `autoIndex` is off, because Mongoose
otherwise creates them in the background the moment a model is used, which on a
live collection is an unannounced write-blocking build. Run `npm run indexes`
deliberately — it also migrates any duplicate open sessions left by older builds,
keeping whichever holds the most turns.

### Sign-in while the sending domain is unverified

Resend refuses every recipient except the account owner until you verify a
domain, so out of the box only your own address receives mail.

**In development**, an undeliverable address is not an error: the API returns
the code in the response and the sign-in screen fills it in for you, behind a
visible "Development mode" notice. Any address signs in.

**In production** the same failure returns `502 email_undeliverable` with a
message that names the cause. The code is never returned and never logged — the
development path is gated on `NODE_ENV`, and returning a code from an
unauthenticated endpoint in production would be account takeover by request.

To make real addresses work, verify a domain at resend.com/domains and set
`RESEND_FROM` to an address on it.

## Deployment

Frontend on Vercel, API on Render. Deploy the API first — the frontend needs its
URL.

### 1. Render (API)

Blueprint at `render.yaml`. The repository root is the npm workspace root, so
leave **Root Directory** blank.

Set the `sync: false` variables in the dashboard:

| Variable | Value |
| --- | --- |
| `CORS_ORIGINS` | your exact Vercel origin, no trailing slash |
| `APP_URL` | the same Vercel origin (used for links in emails) |
| `MONGODB_URI` | Atlas connection string |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM` | as in `.env` |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | see rate limiting below |

`JWT_SECRET` and `CRON_SECRET` are generated by Render.

In **Atlas → Network Access**, allow `0.0.0.0/0`. Render's free tier has no
static outbound IP, so an allowlist of specific addresses will not work.

### 2. Vercel (web)

Leave **Root Directory** blank — it must be the workspace root, not `frontend/`,
or npm cannot resolve the `@study-loop/shared` workspace and the build fails.
`vercel.json` supplies the build command and the cron.

The cron runs daily: Vercel's Hobby plan rejects anything more frequent. Environment variables:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | your Render URL, e.g. `https://study-loop-api.onrender.com` |
| `CRON_SECRET` | must match the value Render generated |

Then go back and set Render's `CORS_ORIGINS` and `APP_URL` to the Vercel URL.

### Things that will bite in production

**The session cookie is cross-site.** Vercel and Render are different origins,
so the cookie is issued `SameSite=None; Secure`, which browsers only accept over
HTTPS. It therefore works in production and on localhost (same site, different
port) but *not* from a plain-HTTP deployment. `NODE_ENV=production` is what
flips it — do not unset it.

**CORS cannot use a wildcard.** `credentials: true` forbids `*`, so
`CORS_ORIGINS` must be the exact origin. A trailing slash breaks it, and the
symptom is a sign-in that fails with a CORS error rather than a 401.

**`npm ci` drops the compilers under `NODE_ENV=production`.** npm omits
devDependencies when that is set, and `tsup`/`typescript` are dev dependencies,
so the build fails with `tsup: not found` (exit 127). The build command must be
`npm ci --include=dev && npm run build:render`.

**Render's free tier sleeps.** After ~15 minutes idle the instance spins down
and the next request takes ~50 seconds. The health check path slows that down
but does not prevent it. It is the single most common "the app is broken"
report on a free deployment.

**Rate limiting is off until Upstash is configured.** The limiter no-ops and
logs a warning when the two Upstash variables are unset. Sign-in and quiz
generation are then unmetered, which is how a free LLM tier gets drained. Set
them before sharing the URL.

**Resend only delivers to your own address until a domain is verified.** With
the default `onboarding@resend.dev` sender, mail to any other address is
accepted and then dropped. Sign-in codes are the first thing this breaks. Verify
a domain in Resend before other people use the app.

**`NEXT_PUBLIC_API_URL` must be set on Vercel, not just at build time.** The CSP
middleware reads it at runtime to build `connect-src`. If it is missing, the
policy collapses to `'self'` and the browser blocks every API call with no
server-side error — the app simply does nothing.

**Free-tier quotas are the usual cause of a 503.** Groq reserves `max_tokens`
against a per-minute budget, so an oversized request is rejected outright (413)
rather than queued; Gemini has a daily request cap. Either one alone is
survivable — the provider chain falls back and the app keeps working, which is
verified. Both at once returns `503 inference_unavailable` with a retry message
rather than a 500. If you are seeing it often, check `llmCalls`:

```js
db.llmCalls.find({ ok: false }).sort({ createdAt: -1 }).limit(10)
```

Each failed row records the provider, the reason (`rate_limit`,
`request_too_large`, `schema_invalid`, `timeout`, `server_error`) and the
provider's own message, which is enough to tell a quota problem from a bad
request without reproducing anything.

**Embeddings have no fallback.** Groq serves no embedding endpoint, so
`gemini-embedding-001` is a hard dependency of retrieval. It has a separate
quota from the chat models, so chat exhaustion does not take Q&A down with it —
but if embeddings are rate-limited, retrieval stops.

**Model ids drift.** Groq and Google retire hosted models on a few months'
notice. Everything is pinned in `backend/src/config/ai.ts`; `npm run doctor`
checks the configured ids against what your accounts can actually see and names
the replacement candidates.

## Security

- **Sessions** are HS256 JWTs in an httpOnly, `Secure`, `SameSite=None` cookie.
  No token is ever placed in `localStorage`. The one thing stored there is a
  boolean "this browser has signed in before" hint, so a signed-out visitor does
  not trigger a 401 probe on every first page load — forging it only causes a
  request that returns 401 anyway.
- **Sign-in codes** are stored as SHA-256 hashes, never plaintext, compared in
  constant time, capped at five attempts, and removed by a Mongo TTL index.
  Requesting a code always returns 200 so the endpoint cannot be used to
  discover which addresses have accounts.
- **The quiz answer key never leaves the server.** `toClientQuiz()` is the only
  path from a quiz document to a response body, and it drops `correctIndex` and
  `explanation`. Grading happens in the submit handler. The e2e asserts this.
- **Rate limiting always applies.** Upstash is used when configured; otherwise an
  in-process sliding window takes over. It previously no-opped when unconfigured,
  which meant one missing variable silently shipped sign-in and quiz generation
  unmetered.
- **CSP with a per-request nonce**, plus HSTS, `frame-ancestors 'none'`,
  `nosniff`, a restrictive `Permissions-Policy`, and no `X-Powered-By`.
- **Prompt injection**: note text is passed inside a delimited block and the
  system prompt states that instructions appearing within it are content to be
  explained, never commands. Model output is rendered by a small Markdown
  renderer that emits React elements — never `dangerouslySetInnerHTML` — so
  markup in a model response cannot become live DOM.
- **Every request carries an `x-request-id`**, and logs redact `authorization`,
  `cookie`, api keys and embedding vectors.
