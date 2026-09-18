# Google Cloud setup and operations

Current project: `qwiklabs-gcp-02-7df98c2d8335`; region: `asia-southeast1`; Cloud Run service: `weliketrains`.

Public URL: https://weliketrains-191711317812.asia-southeast1.run.app

## Resources

- Cloud Run hosts both mobile web assets and the Express API; 1 vCPU/1 GiB, minimum zero, maximum two instances, concurrency eight.
- Cloud Build and Artifact Registry build/store the container from `Dockerfile`.
- `weliketrains-runtime` has Vertex invocation, service usage, Firestore (when enabled), and individual secret access. Build and scheduler identities are separate. No service-account JSON key is created.
- Secret Manager holds the LTA AccountKey and Web Push private key. VAPID public key is intentionally public. Legacy OneMap secrets may remain in the project but are no longer read or bound by the deployment script.
- Vertex AI uses the global endpoint; Cloud Text-to-Speech provides MP3 output.
- Firestore `(default)` in Singapore stores consented routines with TTL on `routines.expiresAt`.
- `weliketrains-reminders` runs every five minutes using an OIDC identity; `/api/internal/reminders` rejects unauthenticated calls at application level.

## First deployment

Install [Google Cloud CLI](https://cloud.google.com/sdk/docs/install), Node 22.12+ and PowerShell 7. On the original development machine the CLI is also available at `.local/gcloud/google-cloud-sdk/bin/gcloud.cmd` (ignored, not part of the repository).

```powershell
gcloud auth login
npm ci
Copy-Item .env.example .env # only if .env does not already exist
# Edit .env privately if live LTA conditions or optional cloud features are needed.
pwsh -File scripts/deploy-gcp.ps1 -ProjectId YOUR_PROJECT_ID -EnableReminders
```

The script explicitly selects the supplied project rather than changing the user’s global default. It enables required services, sets up resources, imports configured secrets and checks `/api/health`. It does not print secret values. Running setup again creates new secret versions; preserve the ignored `.local/vapid.json` for existing push subscriptions. Do not rotate VAPID casually.

Cloud Run’s attached identity handles Google authentication automatically. For optional **local** Vertex/TTS calls, use `gcloud auth application-default login` and set `ENABLE_VERTEX_LOCAL=true`, `GOOGLE_CLOUD_PROJECT`, and the relevant feature switches. A plain `gcloud auth login` alone is not local application-default authentication. Local demo mode needs neither.

## Manual deployments from the development device

By user decision on 2026-09-19, this repository has no GitHub Actions workflows and no push-to-deploy behavior. No remote workflow verifies a push or changes production; the configured local pre-push hook may still run verification, but it never deploys. Deploy only from the authenticated development device after the user explicitly asks for it in chat:

```powershell
pwsh -File scripts/deploy-code.ps1
```

The script refuses non-`main` branches and uncommitted changes by default, runs `npm run verify`, checks the exact Cloud Build upload list for protected credential paths, deploys with the existing runtime and builder identities, then reads the ready revision and checks `/api/health`. `-AllowNonMain` and `-AllowDirty` are explicit escape hatches and should be used only when the user knowingly requests deployment of that source state.

The original development device also has a personal Codex skill at `C:\Users\Yaw Tia\.codex\skills\weliketrains-deploy` (`$weliketrains-deploy`). It preserves the explicit-request rule, invokes the repository script, diagnoses regional Cloud Build failures, prevents automatic paid retries, verifies traffic and the canonical URL, and records results in `docs/IMPLEMENTATION.md`. The skill is not committed and is not required on another machine; this document and the repository script are the portable workflow.

The container build uses `npm ci --ignore-scripts` because the repository's `prepare` lifecycle script configures workstation Git hooks while the intentional Cloud Build context has neither Git nor `.git`. `.gcloudignore` and `.dockerignore` also exclude `gha-creds-*.json` and the unrelated `temp.txt` from uploads and Docker contexts.

Allow roughly **5–7 minutes** for verification, build and rollout under recent conditions. This is an operational estimate, not a guarantee. A deployment is complete only after the script reports the ready revision and successful application health check.

The former GitHub Workload Identity provider and deployer service account may still exist in the temporary GCP project but are unused. They were not deleted because IAM cleanup is a separate infrastructure change; do not reuse them as an implicit deployment path.

## Deploy code updates without reimporting secrets

```powershell
gcloud run deploy weliketrains --source . --project YOUR_PROJECT_ID --region asia-southeast1 --service-account weliketrains-runtime@YOUR_PROJECT_ID.iam.gserviceaccount.com --build-service-account projects/YOUR_PROJECT_ID/serviceAccounts/weliketrains-builder@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

Existing environment/secret bindings are retained. `.gcloudignore` and `.dockerignore` exclude known local credentials, dependencies, caches, build outputs, temporary GitHub credential files and the unrelated root `temp.txt`. Do not upload `.env`, the SDK directory, authentication files or unrelated temporary files. Prefer `scripts/deploy-code.ps1` because it verifies the upload list before invoking this command.

## Models and connection health

`GEMINI_MODEL` is configurable. This project successfully invoked `gemini-2.5-flash`; a `gemini-3.5-flash` probe returned 429 at setup time. The chosen model is a compatibility decision, not a claim that it is newest. Check Google’s model lifecycle before the team’s event and change the environment variable after verifying access. Model retirement/project limits can change. The app labels a local fallback when the model is unavailable; `integrations.vertex` reports configuration, not successful invocation.

`GET /api/health` verifies the server; `/api/config` returns only public settings and configured-provider booleans. Use the app’s Data & sources for feed-level health. `npx tsx scripts/check-connections.ts` tests local external credentials without printing them; `npx tsx scripts/live-smoke.ts` checks a live Rachel itinerary. `/api/chat` reports `provider: "vertex"` only after a successful model response. `/api/speech` should return `audio/mpeg`.

## Security, cost and lifecycle

There are per-instance API/AI rate limits, request validation, a 48 KB request-body limit, CSP, origin checks, explicit AI/push consent and restricted push-provider destinations. This is a public prototype, not hardened multi-tenant production infrastructure. Add shared quotas, budget alerts and stronger authentication/abuse protection before widespread sharing. A maximum instance count limits compute scaling, not AI/API charges. Avoid repeatedly invoking paid evaluation runs.

Routine expiry excludes data immediately; Firestore TTL physical deletion is asynchronous. The application does not save chat history. Google retains operational logs according to project/platform settings. Review those settings and service terms for production privacy requirements.

Qwiklabs credentials and project lifetime are temporary. Cloud data and the URL may disappear when the lab ends. Keep the Git repository and local ignored credentials under appropriate team control, then redeploy into a durable team-owned project before expiry. Stopping/deleting cloud resources is deliberately not automated by setup; explicitly choose the exact project/resources before cleanup.
