# Hosted beta account setup

The hosted beta is still under development. These steps prepare the operator accounts for the cloud checks in the [production plan](PRODUCTION_PLAN.md); they do not deploy the application. The local application needs neither account.

## Cloudflare

1. Create or sign in to a [Cloudflare account](https://dash.cloudflare.com/).
2. Confirm that Workers uses the **Free** plan. Record the account ID and the plan name for the deployment evidence. Do not activate Workers Paid, R2 or another billing-enabled product for this beta.
3. With Node 24 installed, run these commands from the Git checkout's `hosted/` directory:

   ```sh
   npm ci
   npx wrangler login --scopes account:read user:read
   npx wrangler whoami
   ```

   Complete the browser sign-in locally. This preparation login requests only account/user read access. Deployment permissions will be scoped to the reviewed probe later. Wrangler stores its login locally; do not paste its token into chat or commit it. The pinned Wrangler CLI is supplied by the lockfile. These commands authenticate and inspect access; they do not deploy anything. `whoami` may report missing scopes because this login deliberately omits deployment and unrelated product access. See [Wrangler authentication](https://developers.cloudflare.com/workers/wrangler/commands/general/#login).

SQLite-backed Durable Objects are available on Workers Free. Its hard limits stop operations instead of charging for overages. Account-wide usage still needs checking before the bounded synthetic probe. An alert on a paid account does not meet this project's requirement. See [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## Firebase

1. Create a dedicated save2ship project in the [Firebase console](https://console.firebase.google.com/) and keep it on **Spark**. Do not link a Cloud Billing account. Analytics is optional and is not needed by the planned authentication flow.
2. In Authentication, enable **Google** as the sign-in provider. Choose the project's support email. Do not enable phone/SMS authentication for this beta.
3. Register a web app and retain its Firebase web configuration locally for the P3 integration. Record the project ID. Add authorized application domains when the actual hosted origin is known.

Spark does not require payment information. Linking a billing account upgrades the project to Blaze, which is outside the agreed hosting policy. See [Firebase plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [web project setup](https://firebase.google.com/docs/web/setup) and [Google sign-in setup](https://firebase.google.com/docs/auth/web/google-signin).

No service-account private key is needed for this account preparation. There is no Firebase environment file to fill in yet: the runtime prototype verifies synthetic identities only, and the production browser/authentication adapter is a later phase.

## Handoff

Once the accounts exist, provide the Cloudflare account ID, Firebase project ID and confirmation of Free/Spark plan status. These identifiers are not credentials. The remaining work is to validate the bounded cloud probe, record real CPU and resource usage, then implement the private workspace and sign-in phases. The public API stays closed until identity and membership checks are implemented and reviewed.
