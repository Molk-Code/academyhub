# Provisioning a new customer

One Firebase project per customer, one codebase. The customer is chosen at
build and deploy time: `vite --mode <customerId>` for the web app,
`functions/.env.<projectId>` for Cloud Functions, and
`firebase.<customerId>.json` (which generates `firestore.<customerId>.rules`)
for the deploy. Molkom keeps the default files (`.env`, `firebase.json`,
`firestore.rules`); cineforge-eu uses `.env.eu` and `firebase.eu.json`.

Everything below was learned setting up cineforge-eu; the "why" notes are
the problems we actually hit.

## 0. Decide

| Decision | Default | Notes |
|---|---|---|
| Customer id | e.g. `acme-films` | lowercase, digits, dashes; becomes `schools/<id>` and the build mode |
| Firebase project id | e.g. `acme-films-eu` | must be globally unique |
| Modules | all three | `academy`, `production`, `rental_inventory` (core is always on) |
| Front door | first module | what the login page offers besides sign-in |
| Region | Firestore `eur3`, Functions `europe-west1`, Storage EU | keep everything in the EU |
| Domain | `<project>.web.app` | custom domain recommended *before* go-live — changing it later means every user reinstalls the PWA |

## 1. Create the Firebase project (console)

1. Create the project, upgrade to **Blaze**.
2. **Firestore** → create `(default)` in **eur3**. The location can never be changed.
3. **Storage** → get started, EU location. Check the result:
   `gcloud storage buckets describe gs://<project>.firebasestorage.app --format="value(location)"`
4. **Authentication** → Get started → enable **Email/Password** (Email link off — same as production).
5. **Project settings → Your apps → Add web app**. Or:
   `firebase apps:create WEB "<Name>" --project <project>` then `firebase apps:sdkconfig WEB <appId> --project <project>`.
6. **Cloud Messaging → Web Push certificates** → generate a key pair (the VAPID key).

## 2. Provision locally

```
node scripts/provision-customer.mjs <customerId> --project <project> \
  --name "Acme Films" --modules production,rental_inventory \
  --front-door production --max-students 40 --storage-gb 20 --domain app.acme.example
```

This writes (and never overwrites):

- `.env.<customerId>` — gitignored. Paste the web app config and VAPID key into it.
  Vite loads `.env` first and this on top, so **every key in it must stay set** —
  otherwise Molkom's value leaks into the customer's build.
- `functions/.env.<project>` — `FUNCTIONS_REGION`, `SCHOOL_ID`, `APP_URL`, `BACKUP_BUCKET` (committed, no secrets).
- `firebase.<customerId>.json` — hosting serves `dist-<customerId>`; Firestore deploys
  `firestore.<customerId>.rules`, regenerated from `firestore.rules` by
  `scripts/build-rules.mjs` before every deploy.
- With `--project`: seeds `schools/<customerId>` (modules, limits, `publicShop: false`,
  status `trial`) and `public_config/main` (name, front door). It refuses to overwrite an
  existing school (`--overwrite` to force) and refuses the production project outright.

Without `--project` it writes only the local files and prints the next steps.

## 3. One-time cloud setup (gcloud)

```
gcloud app create --region=europe-west --project <project>
gcloud beta services identity create --service=cloudfunctions.googleapis.com --project <project>
gcloud beta services identity create --service=run.googleapis.com --project <project>
gcloud beta services identity create --service=cloudbuild.googleapis.com --project <project>
gcloud beta services identity create --service=firestore.googleapis.com --project <project>
gcloud storage buckets create gs://<project>-backups --location=EU \
  --uniform-bucket-level-access --public-access-prevention --project <project>
gcloud storage buckets update gs://<project>-backups --lifecycle-file=<delete after 30 days>
gcloud storage buckets add-iam-policy-binding gs://<project>-backups \
  --member=serviceAccount:service-<projectNumber>@gcp-sa-firestore.iam.gserviceaccount.com --role=roles/storage.admin
gcloud projects add-iam-policy-binding <project> \
  --member=serviceAccount:<project>@appspot.gserviceaccount.com --role=roles/datastore.importExportAdmin --condition=None
```

Why:
- **App Engine app** — 1st-gen functions run as `<project>@appspot.gserviceaccount.com`,
  which only exists once an App Engine app does (`europe-west`, permanent, free if unused).
- **Service identities** — a new project's service agents aren't provisioned until first use;
  the first functions deploy fails with "Could not authenticate … gcf-admin-robot" without them.
- **Backups bucket + roles** — the nightly export writes there; a missing bucket shows up only
  as a silent 403 in the logs (production ran 30+ days without a backup this way). After the
  first deploy, run the job once and check files appear (step 6).

## 4. Secrets and superadmin

```
pbpaste | firebase functions:secrets:set RESEND_API_KEY --project <project> --data-file -
```

- Use a **separate Resend key** per customer (revocable on its own), restricted to the
  sending domain. `!`-commands in Claude Code can't answer prompts — hence `--data-file -`.
- Resend: add the sending domain in the **EU region** and its DNS records; set
  `email_config/global` (`fromName`, `fromEmail`) once the domain is verified.
- `functions/.env` (gitignored, shared by every project) must contain
  `SUPERADMIN_EMAILS=…`. If it's missing, nobody is superadmin (fails closed).

## 5. Deploy (in this order)

```
firebase deploy --config firebase.<customerId>.json --only firestore,storage --project <project>
firebase deploy --config firebase.<customerId>.json --only functions --project <project> --non-interactive
firebase functions:artifacts:setpolicy --project <project> --location europe-west1 --force
firebase deploy --config firebase.<customerId>.json --only hosting --project <project>
```

- Rules and indexes first: queries fail until indexes exist.
- Functions: if a create fails with "Quota Exceeded" it is retried automatically — check
  `gcloud functions list --project <project>` shows every function `ACTIVE`.
- Scheduled functions create their Cloud Scheduler jobs in `us-central1`; they only hold
  the timer, the functions run in the EU.

## 6. Domain

1. Hosting → **Add custom domain** → enter the domain; add the TXT and A records at the
   DNS host (root domain: leave the name field empty). Remove any parking A record.
2. Wait for **Connected** (DNS caches "no record" for the SOA minimum, often 30 min; the
   certificate follows). Don't set up SSL at the DNS host.
3. If the front page still shows "Site Not Found" once connected, redeploy hosting — it
   clears the CDN's cached 404.
4. Add the domain to Auth → **authorized domains**; set `APP_URL=https://<domain>` in
   `functions/.env.<project>` and redeploy functions (password-reset links).
5. If Microsoft sign-in (SharePoint/video) is used: add the domain to the Entra app's
   redirect URIs.

## 7. First admin

Sign in as superadmin → `/superadmin` → the customer's school: check modules, public shop
(off by default), limits, and the login page profile (logo, colour, tagline, front door).
Then invite the customer's first admin from **Users**.

## 8. Smoke test

- [ ] `https://<domain>` shows the customer's login page (logo, name, colour, front door).
- [ ] Contact and Privacy links work; provider details show (set `public_config/main.legal`).
- [ ] The first admin can sign in; the sidebar shows only the bought modules.
- [ ] A direct URL to a module that's off redirects away (e.g. `/admin/production-roles`).
- [ ] `/shop`: closed unless the public shop is switched on.
- [ ] Invite email arrives (Resend domain verified, `email_config/global` set).
- [ ] `gcloud scheduler jobs run firebase-schedule-dailyFirestoreBackup-europe-west1 --location us-central1 --project <project>`
      → files appear in `gs://<project>-backups/firestore-backups/<date>/`.
- [ ] `firebase functions:list --project <project>`: everything in `europe-west1`.

## Local testing of a profile (no cloud)

```
firebase emulators:start --only auth,firestore,functions --project demo-cineforge
node scripts/seed-emulator.mjs
npx vite --mode emulator
```

Then set modules from `/superadmin` (emulator admin is superadmin there).
