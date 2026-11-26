# EMSystems Linux deployment

This directory contains templates. Nothing here has been installed on a VPS by this repository change.

## 1. Release package

On the build workstation, run `npm run release`. The command runs the production build, validates text files as UTF-8, normalizes filenames to NFC, rejects case-insensitive filename collisions and symbolic links, writes a SHA-256 manifest, and creates a ZIP under `releases/`. It excludes `.env`, SQLite files, payment state, local backups, `node_modules`, tests, and local test output. Inspect the manifest and archive before publishing it.

The package requires Node.js `>=22.13.0`. Install dependencies on the target host with `npm ci --omit=dev` only if the runtime package needs no development tooling; the frontend bundle is already included as `dist/`.

## 2. Service account and persistent state

Create a dedicated service identity and application directories:

```sh
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin emsystems
sudo install -d -o emsystems -g emsystems -m 0750 /opt/emsystems/current
sudo install -d -o emsystems -g emsystems -m 0700 /var/lib/emsystems
sudo install -d -o emsystems -g emsystems -m 0700 /var/lib/emsystems/payments
sudo install -d -o root -g emsystems -m 0750 /etc/emsystems
```

Extract the release to `/opt/emsystems/current`, owned by `emsystems:emsystems`. Keep persistent SQLite/payment state outside the release directory. The API binds to `127.0.0.1:5176`; payment service binds to `127.0.0.1:5175`.

## 3. Environment secrets

Copy `app-api.env.example` to `/etc/emsystems/app-api.env` and `payment.env.example` to `/etc/emsystems/payment.env`. Configure the same random `PAYMENT_SERVICE_TOKEN` in both files; generate one with `openssl rand -hex 32`. Set the AES backup key in the API environment using 32 random bytes encoded as 64 hex characters. Keep this key outside the backup directory and store a recovery copy in a secrets manager.

Set correct public HTTPS URLs and merchant credentials. Configure a valid MoMo IPN endpoint and register the exact VNPAY IPN/return URL in the merchant portal. `PAYMENT_PUBLIC_BASE_URL` must be the public HTTPS origin. Do not expose API/payment ports directly to the Internet.

When enabling `EMSYSTEMS_REQUIRE_PHONE_VERIFICATION=true`, configure a Twilio Verify Service and all `TWILIO_*` fields first; otherwise signup and guest checkout phone verification will fail closed. When enabling `EMSYSTEMS_REQUIRE_DATA_CONSENT=true`, publish reviewed privacy terms and verify the consent forms in the browser. Configure Resend and verify the sender domain before allowing password reset or email notices. For ZNS, authorize the OA to the Zalo app, configure an approved template and use the OA token/refresh token pair; the refresh token rotates after each use. The server stores the latest pair in `EMSYSTEMS_ZALO_TOKEN_STATE_FILE`, which must be on a persistent path writable only by the `emsystems` service account.

Set ownership and permissions:

```sh
sudo chown root:emsystems /etc/emsystems/app-api.env /etc/emsystems/payment.env
sudo chmod 0640 /etc/emsystems/app-api.env /etc/emsystems/payment.env
```

Set `EMSYSTEMS_BOOTSTRAP_ADMIN_PASSWORD` only for the first admin credential bootstrap if needed; remove it after the first successful startup. Existing credentials are not overwritten.

## 4. systemd

```sh
sudo install -m 0644 emsystems-api.service /etc/systemd/system/
sudo install -m 0644 emsystems-payments.service /etc/systemd/system/
sudo install -m 0644 emsystems-backup-cloud.service /etc/systemd/system/
sudo install -m 0644 emsystems-backup-cloud.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now emsystems-api.service emsystems-payments.service
sudo systemctl status emsystems-api.service emsystems-payments.service
```

Check logs with `journalctl -u emsystems-api -f` and `journalctl -u emsystems-payments -f`. Both units restart after an unexpected failure and write logs to journald. Configure journald limits with `emsystems-journald.conf.example` if appropriate for the host.

## 4.1 Daily off-site backup to Cloudflare R2 / Amazon S3

Configure `EMSYSTEMS_S3_ENDPOINT`, `EMSYSTEMS_S3_BUCKET`, `EMSYSTEMS_S3_REGION`, `EMSYSTEMS_S3_ACCESS_KEY_ID`, `EMSYSTEMS_S3_SECRET_ACCESS_KEY` and `EMSYSTEMS_S3_PREFIX` in `/etc/emsystems/app-api.env`. For Cloudflare R2, the endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` and region is `auto`. Create a bucket and a token restricted to that bucket, with only object-write permission for the backup prefix where possible.

The script first creates the normal AES-256-GCM encrypted local backup, validates the manifest and SHA-256 hashes, then uploads only `*.enc` files and `manifest.json`. It never uploads a plaintext SQLite snapshot or payment state. Enable the daily 03:15 timer:

```sh
sudo systemctl enable --now emsystems-backup-cloud.timer
sudo systemctl list-timers emsystems-backup-cloud.timer
sudo systemctl start emsystems-backup-cloud.service   # first manual run
sudo journalctl -u emsystems-backup-cloud.service -n 100 --no-pager
```

Configure bucket versioning/retention/lifecycle and restrict delete permissions separately. The remote object store is independent from the VPS, but this script does not yet implement cloud download/restore or remote retention deletion. To rehearse recovery, download the encrypted backup folder and manifest from the bucket to the private backup directory, verify hashes, stop both services, and use `npm run restore:data -- <backup-folder> --confirm`. Keep the AES key in a different secret store; losing it makes the encrypted backups unrecoverable.

## 5. Caddy

Use `Caddyfile.example` as the starting point, set `EMSYS_DOMAIN`, validate it with `caddy validate`, then reload Caddy. The example uses the `request_body` directive to cap normal requests at 1 MiB and backup restore requests at 40 MB; this directive is experimental and requires Caddy `v2.10.0+`. The API itself enforces 1 MiB and 38 MiB limits respectively. The access log is configured with rolling size/count/retention limits.

Allow inbound ports 80/443 only. Caddy must be the only public reverse proxy to the two loopback-bound Node services. Confirm that Caddy preserves/appends `X-Forwarded-For` so the application can resolve the trusted client IP from the final proxy hop.

## 6. Post-deployment verification

```sh
curl -fsS https://YOUR_DOMAIN/api/app/healthz
curl -fsS https://YOUR_DOMAIN/api/payments/health
```

Then test a complete sandbox payment from order creation through signed IPN, verify that SQLite shows `completed`, test expiry/cancellation stock release, run an encrypted backup, and rehearse a restore on a separate test instance. Confirm that a late successful IPN for an expired/cancelled order enters `paid_after_cancellation` and is manually reconciled/refunded; it must not be shipped automatically.

The optional `EMSYSTEMS_ALERT_WEBHOOK_URL` sends low-PII 5xx alerts with a five-minute fingerprint cooldown. It is a webhook notification, not Sentry/APM/tracing or an uptime monitor. Configure an external monitor to probe `/api/app/healthz` and `/api/payments/health`, and configure log retention on journald/Caddy. This template does not install a metrics backend, merchant production credentials, a real-money payment refund workflow, or an e-invoice provider. Complete a separate security/operational review before real-money production use.