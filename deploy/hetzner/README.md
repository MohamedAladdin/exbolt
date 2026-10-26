# Hetzner provisioning runbook — wacrm

Everything needed to take a **brand-new Hetzner Cloud server** (Ubuntu or Debian,
no prior config) to a running wacrm deployment: hardened host, Docker, self-hosted
Supabase, nginx + Let's Encrypt in front of the Next.js app, and the Meta webhook
registered.

```
Internet ──► :443 nginx ──► 127.0.0.1:3000   app container (Next.js standalone)
             (TLS)       └─► 127.0.0.1:8000   Supabase API gateway (api.<domain>)
                                               └─► supabase_default docker network
                                                   (db, auth, rest, realtime,
                                                    storage, imgproxy, meta,
                                                    studio, functions, pooler)
```

| File | Purpose |
|---|---|
| `bootstrap.sh` | One-shot, idempotent host provisioning. Run as root on the fresh box. |
| `nginx-wacrm.conf.template` | nginx server block for the app (placeholders: `__DOMAIN__`, `__UPSTREAM__`). |
| `app.compose.yml` | Production compose file for the app container. |
| `README.md` | This runbook. |

Conventions used below — set these in your shell before copy-pasting:

```bash
export DOMAIN=crm.example.com                  # app hostname
export API_DOMAIN=api.crm.example.com          # Supabase API hostname
export EMAIL=ops@example.com                   # Let's Encrypt + admin mail
export SERVER_IP=203.0.113.10                  # Hetzner server IPv4
export REPO_URL=<your fork's git URL>          # e.g. git@github.com:you/wacrm.git
```

---

## 1. Prerequisites

| Need | Detail |
|---|---|
| Server | Hetzner Cloud, **Ubuntu 24.04** (recommended) or **Debian 12/13**. CX22 (2 vCPU/4 GB) is the floor; **CPX31 (4 vCPU/8 GB) or larger** is what this bundle targets — `next build` is memory-hungry and Supabase runs ~10 containers. |
| Local SSH key | An unencrypted-at-use key you can pass on the command line, or an agent you can copy from. The key becomes the only way in (password auth is disabled). |
| DNS control | Ability to create `A` records for `$DOMAIN` and `$API_DOMAIN`. |
| Ports | 22, 80, 443 reachable from the internet. If you attach a **Hetzner Cloud Firewall**, allow them there too — it sits in front of `ufw`. |
| Meta | App ID / App Secret, a webhook verify token you invent, and a WABA to connect later. |
| SMTP | Any SMTP provider. Supabase Auth needs it for sign-up confirmation and password reset (`docs/auth-emails.md` in the repo). |

Create the server with your usual flow (`hcloud server create ...` or the console).
Add your SSH key at creation time if you can — the bootstrap will also accept it as
an argument.

---

## 2. The one command

Copy the bundle to the fresh server and run it as root:

```bash
# 1. copy the bundle (from your laptop, in the repo root)
scp -r deploy/hetzner root@"$SERVER_IP":/root/hetzner-bootstrap

# 2. run it as root, passing the public key you will log in with as ARG 1.
#    The inner single quotes matter: they keep the key's trailing comment intact.
ssh root@"$SERVER_IP" "bash /root/hetzner-bootstrap/bootstrap.sh '$(cat ~/.ssh/id_ed25519.pub)'"
```

If you would rather not put the key on the command line, copy it next to the
bundle and read it there:

```bash
scp ~/.ssh/id_ed25519.pub root@"$SERVER_IP":/root/agent.pub
ssh root@"$SERVER_IP" 'bash /root/hetzner-bootstrap/bootstrap.sh "$(cat /root/agent.pub)"'
```

> The public key argument is **optional but strongly advised**: it is appended to
> both `/root/.ssh/authorized_keys` and `/home/deploy/.ssh/authorized_keys`, and
> password authentication is disabled at the end of the run. With **no key present
> anywhere**, the script refuses to disable password auth and exits (override only
> from a web console, with `WACRM_ALLOW_NO_KEYS=1`).

Runtime: ~3–6 minutes. The script is idempotent — safe to re-run after a failure,
a reboot, or just to confirm state. A second run is a fast no-op.

Optional environment knobs:

| Variable | Effect |
|---|---|
| `WACRM_SSH_PORT=2222` | Also opens that TCP port in `ufw` (you still have to move sshd itself). |
| `WACRM_ALLOW_NO_KEYS=1` | Proceeds with password auth disabled even with zero keys. Lockout risk — console only. |

---

## 3. What `bootstrap.sh` changes

| Step | Effect | Idempotency |
|---|---|---|
| OS check | Aborts unless `/etc/os-release` says `ubuntu` or `debian`. | read-only |
| Base packages | `curl ca-certificates gnupg git jq unzip rsync sudo ufw fail2ban python3-systemd htop ncdu unattended-upgrades apt-listchanges` | `apt-get install` is a no-op when current |
| Swap | Adds `/swapfile`: **1 GB** if RAM ≥ 8 GB, **2 GB** if 4–8 GB, **4 GB** if < 4 GB — only when the host has no swap. Persisted in `/etc/fstab` (backup: `/etc/fstab.wacrm.bak`). | skipped when any swap is active |
| Time | `timedatectl set-timezone UTC`. | idempotent |
| Updates | `/etc/apt/apt.conf.d/20auto-upgrades` (daily metadata refresh + apply) and a replacement `/etc/apt/apt.conf.d/50unattended-upgrades` that allows **only the security pocket** (plus Ubuntu ESM) and never reboots. apt appends list values across files with no way to clear them, so the distro file is replaced rather than amended; the original is kept at `/var/backups/wacrm/50unattended-upgrades.dist`. | files rewritten verbatim |
| `deploy` user | Created (if missing) with `/bin/bash`, home, and `NOPASSWD:ALL` sudo validated by `visudo -cf`. | existing user untouched |
| SSH keys | Root's `authorized_keys` copied to `deploy`; `ARG 1` appended to both, deduplicated on the key blob. Perms forced to `700`/`600`. | no duplicate lines on re-run |
| sshd hardening | `/etc/ssh/sshd_config.d/99-hardening.conf`: `PermitRootLogin prohibit-password`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `X11Forwarding no`, `MaxAuthTries 3`. Adds the `Include` line to `/etc/ssh/sshd_config` if the image lacks it (backup: `.wacrm.bak`). Because sshd honours the **first** value it reads, conflicting directives in *other* drop-ins (Ubuntu's `50-cloud-init.conf` ships `PasswordAuthentication yes`) are commented out — otherwise the 99- file loses. `ssh_pwauth: false` is also written to `/etc/cloud/cloud.cfg.d/` so cloud-init cannot re-add it. **`sshd -t` must pass before the reload** — on failure the drop-in is renamed to `.rejected` and ssh is *not* touched. | file rewritten, conflicting lines neutralised once, validated, reloaded |
| Firewall | `ufw` default deny incoming / allow outgoing; TCP 22, 80, 443 open; enabled non-interactively. | `ufw allow` on an existing rule is a no-op |
| fail2ban | `/etc/fail2ban/jail.d/wacrm-sshd.local`: `sshd` jail, `maxretry=5`, `findtime=10m`, `bantime=1h`, `banaction=ufw`, `backend=systemd` (Ubuntu 24.04 has no syslog). | rewritten + reloaded |
| Docker | Official Docker apt repo + `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin`. `deploy` joins the `docker` group. | **skipped entirely** when `docker` + `docker compose` already work |
| Node.js | NodeSource 22.x, only when `node` is missing or major < 22. | skipped when ≥ 22 |
| nginx + certbot | `nginx`, `python3-certbot-nginx`; nginx enabled and started. | apt no-op, service already running |
| Directories | `/srv/wacrm`, `/srv/supabase`, `/var/log/wacrm` — `deploy:deploy`, mode `750`. | `install -d` |
| Summary | Prints OS, kernel, CPU/RAM, swap, disk, timezone, Docker/Compose/Node/nginx/certbot versions, users, paths, ufw state and **effective** `sshd -T` auth settings. | — |

Nothing in the script writes an application secret. `.env.production` is yours to
create in step 8.2.

---

## 4. Verify the host

Reconnect as the deploy user (root key login also still works):

```bash
ssh deploy@"$SERVER_IP"          # must succeed *without* a password prompt
```

Then check each guarantee:

```bash
# SSH posture — expect the six lines below
sudo sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|x11forwarding|maxauthtries|pubkeyauthentication) '
# permitrootlogin prohibit-password
# pubkeyauthentication yes
# passwordauthentication no
# kbdinteractiveauthentication no
# x11forwarding no
# maxauthtries 3

# Firewall
sudo ufw status verbose
# Status: active
# Default: deny (incoming), allow (outgoing), disabled (routed)
# 22/tcp  ALLOW IN  Anywhere   # ssh
# 80/tcp  ALLOW IN  Anywhere   # http - letsencrypt + redirect
# 443/tcp ALLOW IN  Anywhere   # https

# fail2ban
sudo fail2ban-client status sshd
# Status for the jail: sshd
# |- Filter
# |  |- Currently failed: 0
# |- Actions
#    |- Currently banned: 0

# Toolchain
docker --version && docker compose version && node --version && nginx -v
# Docker version 27.x / Docker Compose version v2.x / v22.x / nginx version: nginx/1.24.0

# Swap + time + dirs
swapon --show && timedatectl | grep 'Time zone' && ls -ld /srv/wacrm /srv/supabase /var/log/wacrm
```

If `/var/run/reboot-required` exists (kernel/libc upgraded during the run), reboot
now — before deploying anything: `sudo reboot`.

---

## 5. Layout on the server

| Path | Contents |
|---|---|
| `/srv/wacrm` | Git checkout of this repo (app source + `Dockerfile` + `deploy/hetzner/*`). `deploy:deploy`, `750`. |
| `/srv/wacrm/.env.production` | App secrets/config, `chmod 600 deploy:deploy`, **never committed** (`.gitignore` has `.env*`). |
| `/srv/supabase` | Self-hosted Supabase stack root: `docker-compose.yml`, `.env`, `volumes/` (db data + storage objects) and `backups/`. |
| `/var/log/wacrm` | Free for app-level log shipping. Docker's own json logs live under `/var/lib/docker/containers` and are capped at 10 MB × 3 per container. |
| `/etc/nginx/sites-available/wacrm.conf` | Rendered from `nginx-wacrm.conf.template`. |
| `/etc/letsencrypt/` | Certbot-managed certs and renewal config. |

Logs, when you need them:

```bash
cd /srv/wacrm
docker compose --env-file .env.production -f deploy/hetzner/app.compose.yml logs -f --tail=200 app   # app
sudo tail -f /var/log/nginx/error.log                                     # proxy
sudo journalctl -u docker -n 100                                          # daemon
```

---

## 6. DNS + TLS

### 6.1 DNS

Create two `A` records (and `AAAA` if the server has IPv6):

```
crm.example.com      A    203.0.113.10
api.crm.example.com  A    203.0.113.10
```

Confirm propagation from the server before asking Let's Encrypt for anything — a
failed validation counts against rate limits:

```bash
getent hosts "$DOMAIN" "$API_DOMAIN"      # both must print $SERVER_IP
```

### 6.2 Certificate for the app hostname (ACME bootstrap)

The TLS block in the template needs a certificate that does not exist yet. Obtain
it first with a throwaway ACME-only server block on :80:

```bash
sudo mkdir -p /var/www/certbot

sudo tee /etc/nginx/sites-available/wacrm-acme.conf >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
}
EOF

sudo ln -sfn /etc/nginx/sites-available/wacrm-acme.conf /etc/nginx/sites-enabled/wacrm-acme.conf
sudo nginx -t && sudo systemctl reload nginx

sudo certbot certonly --webroot -w /var/www/certbot \
  -d "${DOMAIN}" --agree-tos -m "${EMAIL}" --non-interactive \
  --deploy-hook "systemctl reload nginx"
```

Expected tail:

```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/crm.example.com/fullchain.pem
```

### 6.3 Enable the real site

```bash
cd /root/hetzner-bootstrap    # or wherever you copied the bundle

sudo sed -e "s|__DOMAIN__|${DOMAIN}|g" -e "s|__UPSTREAM__|127.0.0.1:3000|g" \
  nginx-wacrm.conf.template | sudo tee /etc/nginx/sites-available/wacrm.conf >/dev/null

sudo ln -sfn /etc/nginx/sites-available/wacrm.conf /etc/nginx/sites-enabled/wacrm.conf
sudo rm -f /etc/nginx/sites-enabled/wacrm-acme.conf /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` must say `syntax is ok` / `test is successful`. On nginx ≥ 1.25.1 it
also prints a deprecation warning about `listen ... http2` — harmless; switch to
`http2 on;` if you care (see the comment in the template).

At this point `https://crm.example.com` answers with a 502 (nothing is listening
on 3000 yet) — that is the correct intermediate state.

### 6.4 Certificate for the Supabase API hostname

Same pattern, one more site. This is the only nginx config not shipped as a file
in the bundle, because its upstream ports depend on the Supabase stack (step 7).

```bash
sudo tee /etc/nginx/sites-available/supabase-api-acme.conf >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${API_DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
}
EOF
sudo ln -sfn /etc/nginx/sites-available/supabase-api-acme.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/certbot \
  -d "${API_DOMAIN}" --agree-tos -m "${EMAIL}" --non-interactive \
  --deploy-hook "systemctl reload nginx"
sudo rm -f /etc/nginx/sites-enabled/supabase-api-acme.conf
```

Then the proxying site (Kong/envoy path-routes `/auth/v1`, `/rest/v1`,
`/storage/v1`, `/realtime/v1` itself, so a single `location /` is enough):

```bash
sudo tee /etc/nginx/sites-available/supabase-api.conf >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${API_DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${API_DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${API_DOMAIN}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:supabase_tls:10m;

    client_max_body_size 25m;   # storage uploads (Meta caps media at 16 MB)

    # Realtime needs a long-lived upgraded connection.
    location /realtime/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
sudo ln -sfn /etc/nginx/sites-available/supabase-api.conf /etc/nginx/sites-enabled/supabase-api.conf
sudo nginx -t && sudo systemctl reload nginx
```

Renewals are already handled: certbot's systemd timer (`certbot.timer`) renews, and
the `--deploy-hook` reloads nginx. Verify with `sudo certbot renew --dry-run`.

---

## 7. Self-hosted Supabase

The stack lives in `/srv/supabase`. We use the official `supabase/docker` compose
files, run with the Compose project name **`supabase`** so the network is
`supabase_default` — the name `app.compose.yml` joins.

```bash
sudo -iu deploy
cd /srv/supabase

git clone --depth 1 https://github.com/supabase/supabase.git src
cp -a src/docker/. .            # compose + volumes/ skeletons at /srv/supabase
rm -rf src
cp .env.example .env
chmod 600 .env
```

### 7.1 Generate secrets

```bash
cd /srv/supabase
POSTGRES_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=' | head -c 40)"
JWT_SECRET="$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
echo "JWT_SECRET=$JWT_SECRET"
```

Then mint the two JWTs Supabase expects (HS256, signed with `JWT_SECRET`) — no
extra tooling needed, `python3` is on the box:

```bash
JWT_SECRET="$JWT_SECRET" python3 - <<'PY'
import base64, hashlib, hmac, json, os, time

def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

secret = os.environ["JWT_SECRET"].encode()

def sign(role: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {"iss": "supabase", "ref": "self-hosted", "role": role,
               "iat": int(time.time()), "exp": int(time.time()) + 10 * 365 * 86400}
    body = b64(json.dumps(header, separators=(",", ":")).encode()) + "." + \
           b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(secret, body.encode(), hashlib.sha256).digest()
    return body + "." + b64(sig)

print("ANON_KEY=" + sign("anon"))
print("SERVICE_ROLE_KEY=" + sign("service_role"))
PY
```

Copy the two printed values into `.env` (and later into `.env.production`).

### 7.2 Point Supabase at your domain

Edit `/srv/supabase/.env`. The values that matter for wacrm:

```env
POSTGRES_PASSWORD=<the generated password>
JWT_SECRET=<the generated secret>
ANON_KEY=<generated>
SERVICE_ROLE_KEY=<generated>

DASHBOARD_USERNAME=supabase
DASHBOARD_PASSWORD=<a long random password — Studio is reachable, protect it>
SECRET_KEY_BASE=<openssl rand -hex 32>
VAULT_ENC_KEY=<openssl rand -hex 16>          # exactly 32 chars
PG_META_CRYPTO_KEY=<openssl rand -hex 16>     # >= 32 chars
LOGFLARE_PUBLIC_ACCESS_TOKEN=<openssl rand -hex 32>
LOGFLARE_PRIVATE_ACCESS_TOKEN=<openssl rand -hex 32>

SUPABASE_PUBLIC_URL=https://api.crm.example.com
API_EXTERNAL_URL=https://api.crm.example.com/auth/v1

# Auth links must come back to the app, not to localhost.
SITE_URL=https://crm.example.com
ADDITIONAL_REDIRECT_URLS=https://crm.example.com/**
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=false

# Supabase Auth emails (sign-up confirmation, password reset).
SMTP_ADMIN_EMAIL=ops@example.com
SMTP_SENDER_NAME=wacrm
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
```

`SITE_URL` is the single most common self-hosted mistake: leave it at
`http://localhost:3000` and every confirmation/reset mail points at localhost.
See `docs/auth-emails.md` in the repo.

### 7.3 Keep the database off the public internet

Docker publishes ports through its own iptables NAT rules, **bypassing `ufw`** — a
`5432:5432` mapping is world-reachable even with `ufw` denying incoming. Bind the
data ports to loopback in `/srv/supabase/docker-compose.yml`:

```yaml
  db:
    ports:
      - 127.0.0.1:${POSTGRES_PORT:-5432}:5432/tcp
  supavisor:
    ports:
      - 127.0.0.1:${POOLER_PROXY_PORT_TRANSACTION:-6543}:6543/tcp
```

(Verifying from your laptop after startup: `nc -zv $SERVER_IP 5432` must fail.)

### 7.4 Start it

```bash
cd /srv/supabase
docker compose up -d
docker compose ps                      # every service Up / healthy
docker network ls | grep supabase      # supabase_default exists
```

Studio is served through the gateway at `https://api.crm.example.com/project/default`
with `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`.

Smoke test the gateway — anything but `502` (curl error 7 / nginx error page) proves
nginx reaches it. No credentials needed for this one:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://api.crm.example.com/auth/v1/health
# 200

curl -sS -o /dev/null -w '%{http_code}\n' https://api.crm.example.com/rest/v1/
# 401 or 200 — both mean the request reached PostgREST; 502 means nginx/gateway is down
```


---

## 8. The app

### 8.1 Get the code onto the server

**Git (recommended)** — the compose file's build context is the repo root, so the
checkout must live at `/srv/wacrm` itself. Run this *before* creating
`.env.production`: `git clone` refuses a non-empty directory.

```bash
sudo -iu deploy
cd /srv/wacrm
git clone "$REPO_URL" .        # /srv/wacrm must still be empty here
git log --oneline -1
```

**Or rsync** from your laptop (when the server cannot reach the git host):

```bash
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude '.env*' --exclude 'tsconfig.tsbuildinfo' \
  ./ deploy@"$SERVER_IP":/srv/wacrm/
```

### 8.2 Production env checklist

Create `/srv/wacrm/.env.production` (**owner** `deploy`, **mode** `600`). Nothing
here is committed; `.gitignore` ignores `.env*` and `.dockerignore` keeps it out of
the image.

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | `https://api.<your-domain>` — the Supabase API hostname from step 6.4. **Baked into the client bundle at build time.** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | The `ANON_KEY` generated in 7.1. Baked at build time. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | The `SERVICE_ROLE_KEY` from 7.1. Runtime only, server-side, bypasses RLS — never expose it to the browser. |
| `ENCRYPTION_KEY` | ✅ | Exactly **64 hex chars** (32 bytes, AES-256-GCM) for WhatsApp token + AI key encryption. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Rotating it orphans every stored token** — users must re-save WhatsApp settings. |
| `META_APP_SECRET` | ✅ | Meta App Secret; HMAC-SHA256 verification of every inbound webhook POST. Comma-separate several app secrets for a multi-Meta-App setup (`docs/multi-waba.md`). |
| `META_WEBHOOK_VERIFY_TOKEN` | ✅ | Any long random string you also paste into the Meta callback config. It is the app-level verify token for Messenger/Instagram subscriptions; per-number tokens live in `whatsapp_config`. |
| `NEXT_PUBLIC_SITE_URL` | ✅ | `https://<your-domain>`. Used for sitemap/OG and invite links generated outside a request. Baked at build time. |
| `NEXT_PUBLIC_APP_LOCALE` | ✅ | `en` \| `ko` \| `pt` \| `es`. Baked at build time — changing it means rebuilding. |
| `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` | ⬜ | Digits only, e.g. `20` (Egypt) or `1` (US). Default dialling code used when promoting a typed phone number to E.164. Set it if your users enter local numbers. |
| `WHATSAPP_TEMPLATES_DRY_RUN` | ⬜ | Must be `false`/unset in production. `true` skips the Meta call and stores fake template IDs — that setting exists for CI. |
| `AUTOMATION_CRON_SECRET` | ✅ if you use Wait steps / flows | Shared secret for `GET /api/automations/cron` and `GET /api/flows/cron` (sent as `x-cron-secret`). Without it those endpoints return 503. `openssl rand -hex 32`. |
| `META_GRAPH_VERSION` | ⬜ | Pins the Graph API version, e.g. `v23.0` (the in-code default). Set it only to override. |
| `META_APP_ID` | ⬜ | Needed only for templates with an IMAGE header (Resumable Upload). |
| `ALLOWED_INVITE_HOSTS` | ⬜ | Extra defence for invite links when `NEXT_PUBLIC_SITE_URL` cannot be relied on. |
| `SUPABASE_PROXY` | ❌ **must be unset** | Local-dev only: rewrites `/auth`, `/rest`, `/storage` through the app origin (`next.config.ts`). Setting it in production 404s every Supabase call from the browser. |

Template (replace the placeholders, then `chmod 600`):

```env
# ---- Supabase (self-hosted, step 7) ----
NEXT_PUBLIC_SUPABASE_URL=https://api.crm.example.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>

# ---- App ----
NEXT_PUBLIC_SITE_URL=https://crm.example.com
NEXT_PUBLIC_APP_LOCALE=en
NEXT_PUBLIC_DEFAULT_COUNTRY_CODE=20
ENCRYPTION_KEY=<64 hex chars>
AUTOMATION_CRON_SECRET=<openssl rand -hex 32>

# ---- Meta ----
META_APP_SECRET=<app secret>
META_WEBHOOK_VERIFY_TOKEN=<long random string>
META_GRAPH_VERSION=v23.0
WHATSAPP_TEMPLATES_DRY_RUN=false

# SUPABASE_PROXY is deliberately absent — it must not be set in production.
```

```bash
sudo -iu deploy
cd /srv/wacrm
install -m 600 /dev/null .env.production    # then edit it
```

### 8.3 Apply the database migrations

The app's schema, RLS policies and the `chat-media` / avatar / flow-media storage
buckets are all created by `supabase/migrations/*.sql` — nothing is created by the
containers.

```bash
cd /srv/wacrm
# libpq honours PGPASSWORD, so the URL does not need to carry the secret
export PGPASSWORD="$(grep -E '^POSTGRES_PASSWORD=' /srv/supabase/.env | cut -d= -f2-)"
npx --yes supabase@latest db push \
  --db-url "postgresql://postgres@127.0.0.1:5432/postgres"
```

Verify:

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "select count(*) from supabase_migrations.schema_migrations;"
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "select id from storage.buckets order by id;"
# avatars / chat-media / flow-media
```

Re-running `db push` after a `git pull` applies new migrations only.

### 8.4 Build and run

```bash
cd /srv/wacrm

# The app joins the Supabase network; create it once if Supabase is not up yet.
docker network inspect supabase_default >/dev/null 2>&1 || docker network create supabase_default

# `--env-file` is required for EVERY compose command in this project, not just
# the build: Compose interpolates the file even for `logs` and `ps`, so leaving
# it off is an error rather than a no-op.
DC="docker compose --env-file .env.production -f deploy/hetzner/app.compose.yml"

$DC up -d --build
```

`--env-file` is not optional: Compose interpolates the `NEXT_PUBLIC_*` **build
args** from it. Without the flag the build fails loudly (`NEXT_PUBLIC_SUPABASE_URL
is required`) rather than silently shipping an app with an empty Supabase URL.

Watch the first build (~2–5 min) and then the container:

```bash
$DC logs -f app
```

Expected: `▲ Next.js ... Ready in ...ms`, and a healthcheck that flips to `healthy`
within `start_period` (40 s):

```bash
$DC ps
# NAME        IMAGE          STATUS
# wacrm-app-1 wacrm:latest   Up 2 minutes (healthy)
```

### 8.5 Verify end to end

```bash
# 1. app answers on loopback
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login          # 200

# 2. through nginx, over TLS, with the real hostname
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://crm.example.com/login   # 200
curl -sSI http://crm.example.com/login | head -3                                # 301 -> https

# 3. browser-level check: sign up, confirm the mail arrives with a
#    https://crm.example.com/auth/callback?... link (not localhost)

# 4. Supabase reachable from the app container by service name
$DC exec -T app node -e "fetch('http://kong:8000/auth/v1/health').then(r=>console.log('gateway',r.status))"
```

> On current Supabase compose files the API gateway is Envoy, published under the
> network aliases `kong` **and** `envoy` for backwards compatibility — hence
> `http://kong:8000` still resolves. The app normally talks to Supabase through
> `NEXT_PUBLIC_SUPABASE_URL` (public HTTPS) anyway; the shared network is there so
> server-side code can skip the round trip if you ever want it to.

### 8.6 Deploying an update

```bash
sudo -iu deploy
cd /srv/wacrm
DC="docker compose --env-file .env.production -f deploy/hetzner/app.compose.yml"

git pull --ff-only
$DC up -d --build
```

Tag the previous image first if you want a fast rollback:

```bash
docker tag wacrm:latest "wacrm:$(git rev-parse --short HEAD)"
```

Only `NEXT_PUBLIC_*` changes require `--build`; runtime secrets (service-role key,
Meta secrets, `ENCRYPTION_KEY`) take effect with `up -d` alone. Expect ~10–20 s of
downtime while the container is recreated — acceptable for a single-node deploy;
for zero downtime put a second replica behind nginx upstreams.

---

## 9. Register the Meta webhook

In **Meta for Developers → your app → WhatsApp → Configuration** (and the
Messenger / Instagram equivalents, which share the same callback):

| Field | Value |
|---|---|
| Callback URL | `https://crm.example.com/api/whatsapp/webhook` |
| Verify token | the exact value of `META_WEBHOOK_VERIFY_TOKEN` |

Subscribe to the **`messages`** field on the WABA; for Messenger/Instagram
subscribe each connected page/account.

The handshake is a `GET` with `hub.mode=subscribe`; test it yourself so a failure
is not ambiguous:

```bash
curl -sS "https://crm.example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${META_WEBHOOK_VERIFY_TOKEN}&hub.challenge=42"
# 42
```

A `403` means the token does not match `META_WEBHOOK_VERIFY_TOKEN` (or any
`whatsapp_config.verify_token`); a `404`/`502` means nginx or the container is not
serving that path. Inbound POSTs are rejected unless their `X-Hub-Signature-256`
matches `META_APP_SECRET`.

---

## 10. Scheduled endpoints (automations + flows)

Nothing is scheduled inside the container. Wait steps and flows need an external
pinger. Two endpoints, both authenticated with the `x-cron-secret` header
(`AUTOMATION_CRON_SECRET`): `GET /api/automations/cron` and `GET /api/flows/cron`.

A one-line crontab is tempting but keeps the secret in a world-readable file and
breaks on quoting. Use a script instead — `/srv/wacrm/cron-ping.sh`:

```bash
sudo -u deploy tee /srv/wacrm/cron-ping.sh >/dev/null <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
SECRET="$(grep -E '^AUTOMATION_CRON_SECRET=' /srv/wacrm/.env.production | cut -d= -f2-)"
[[ -n "${SECRET}" ]] || { echo "AUTOMATION_CRON_SECRET not set" >&2; exit 1; }
for endpoint in automations flows; do
  curl -fsS -m 120 -H "x-cron-secret: ${SECRET}" \
    "https://crm.example.com/api/${endpoint}/cron" >/dev/null
done
SCRIPT
sudo chmod 750 /srv/wacrm/cron-ping.sh

# ping every 5 minutes; cron.d wants a user column and no inline secrets
echo '*/5 * * * * deploy /srv/wacrm/cron-ping.sh >/dev/null 2>&1' \
  | sudo tee /etc/cron.d/wacrm >/dev/null
sudo chmod 0644 /etc/cron.d/wacrm
```


Check the endpoints answer `200` and not `503` (503 = the secret is not set in the
running container — `up -d` after editing `.env.production`):

```bash
SECRET="$(sudo grep -E '^AUTOMATION_CRON_SECRET=' /srv/wacrm/.env.production | cut -d= -f2-)"
curl -sS -o /dev/null -w '%{http_code}\n' -H "x-cron-secret: ${SECRET}" https://crm.example.com/api/automations/cron
```

---

## 11. Backups

Two things are irreplaceable: the Postgres database and the storage volume (the app
mirrors inbound WhatsApp media there because Meta deletes it after ~30 days).

Nightly script — `/srv/supabase/backup.sh`:

```bash
sudo -u deploy tee /srv/supabase/backup.sh >/dev/null <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
DEST=/srv/supabase/backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DEST"

# 1. logical database dump (custom format, restorable table-by-table)
docker exec supabase-db pg_dump -U postgres -d postgres -Fc \
  > "$DEST/wacrm-db-${STAMP}.dump"

# 2. storage objects (bind mount at /srv/supabase/volumes/storage)
tar czf "$DEST/wacrm-storage-${STAMP}.tar.gz" \
  -C /srv/supabase/volumes storage

# 3. keep 14 days locally
find "$DEST" -type f -mtime +14 -delete
SCRIPT
sudo chmod 750 /srv/supabase/backup.sh

echo '15 3 * * * deploy /srv/supabase/backup.sh >> /var/log/wacrm/backup.log 2>&1' \
  | sudo tee /etc/cron.d/wacrm-backup >/dev/null
sudo chmod 0644 /etc/cron.d/wacrm-backup
```

Off-site copy (Hetzner Storage Box or any rclone remote) — do **not** keep the only
copy on the box being backed up:

```bash
rsync -az --delete /srv/supabase/backups/ u123456@u123456.your-storagebox.de:/wacrm/
```

Restore drill (do this once, on a throwaway database):

```bash
docker exec -i supabase-db psql -U postgres -c 'create database restore_test;'
docker exec -i supabase-db pg_restore -U postgres -d restore_test --no-owner < /srv/supabase/backups/wacrm-db-<stamp>.dump
docker exec -i supabase-db psql -U postgres -d restore_test -c 'select count(*) from accounts;'
docker exec -i supabase-db psql -U postgres -c 'drop database restore_test;'
```

Also back up (small, but annoying to lose): `/srv/wacrm/.env.production`,
`/srv/supabase/.env`, `/etc/nginx/sites-available/*.conf`, and
`/etc/letsencrypt/` (or just re-issue certificates).

---

## 12. Rollback / "I locked myself out"

### 12.1 App rollback

```bash
cd /srv/wacrm
DC="docker compose --env-file .env.production -f deploy/hetzner/app.compose.yml"

docker tag wacrm:latest wacrm:broken-$(date +%s)          # keep the evidence
git log --oneline -10                                     # pick the last good commit
git checkout -B deploy <good-sha>
$DC up -d --build
```

Or run the previously tagged image without rebuilding (fastest):

```bash
docker tag wacrm:<short-sha> wacrm:latest
$DC up -d
```

Database migrations are **not** rolled back by this. If a bad migration shipped,
restore the last dump into a fresh database and point the app at it; never run
`down` migrations against production data you have not dumped first.

### 12.2 SSH lockout

Symptoms: `Permission denied (publickey)` for every key, or `Connection refused`.
Your live session (if any) survives — **do not close it** until login works from a
second terminal.

Recovery order, cheapest first:

1. **Another key / another user.** `ssh deploy@...` and `ssh root@...` use separate
   `authorized_keys`. If root works, fix deploy from there:
   ```bash
   sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
   sudo cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
   sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys && sudo chmod 600 /home/deploy/.ssh/authorized_keys
   ```
2. **Hetzner web console** (Server → Console). It is a VNC session on tty1, no SSH
   involved. If the image has no root password (Hetzner images do not by default),
   use rescue mode instead.
3. **Rescue mode** — the reliable path:
   - Hetzner Cloud Console → your server → **Rescue** tab → select your SSH key →
     **Enable rescue & power on** (server reboots into a rescue system).
   - SSH into the rescue system as `root` (it prints the command and a temporary
     password), then:
     ```bash
     lsblk                                   # find the root partition, usually sda1
     mount /dev/sda1 /mnt
     # the drop-in that broke it:
     cat /mnt/etc/ssh/sshd_config.d/99-hardening.conf
     rm /mnt/etc/ssh/sshd_config.d/99-hardening.conf      # or fix PasswordAuthentication
     # if the Include line itself was the problem, revert the main config:
     # cp /mnt/etc/ssh/sshd_config.wacrm.bak /mnt/etc/ssh/sshd_config
     umount /mnt
     ```
   - Console → **Disable rescue mode**, then reboot. Removing the drop-in restores
     the image's defaults (key login for root, password auth per image config).
4. **Re-run the bootstrap** once you are back in — it rebuilds the hardening from a
   known-good state and prints the effective `sshd -T` settings:
   ```bash
   sudo bash /root/hetzner-bootstrap/bootstrap.sh "$(cat ~/.ssh/id_ed25519.pub)"
   ```

Why this should not happen: the script validates with `sshd -t` **before** reloading
and leaves a rejected drop-in at `/etc/ssh/sshd_config.d/99-hardening.conf.rejected`
with ssh untouched, and it refuses to disable password auth when no key is on the
box.

### 12.3 Certificate / proxy problems

| Symptom | Cause | Fix |
|---|---|---|
| `nginx: [emerg] cannot load certificate` | TLS block enabled before the cert existed | Run 6.2 (ACME bootstrap) first, then 6.3 |
| `502 Bad Gateway` on the app hostname | container down / not on port 3000 | `docker compose ... ps`, `logs app`, `curl 127.0.0.1:3000/login` |
| `413 Request Entity Too Large` | body over 25 MB | `client_max_body_size` in the template |
| Browser console: CSP blocks `https://api.<domain>` | `next.config.ts` `connect-src` lists only `https://*.supabase.co` (report-only, so it logs rather than blocks) | Add your API hostname to the CSP in `next.config.ts` and rebuild — an app change, out of scope for this bundle |
| Cert renewal fails | port 80 blocked, or DNS moved | `sudo certbot renew --dry-run`, check `ufw status`, `dig +short $DOMAIN` |
| `ssh -o PreferredAuthentications=password` still prompts for a password | another `sshd_config.d/*.conf` sets `PasswordAuthentication yes` — sshd takes the first value it sees | `grep -rn PasswordAuthentication /etc/ssh/sshd_config.d/`; comment the line and `sudo systemctl reload ssh`. The bootstrap already does this for `50-cloud-init.conf`; a drop-in added *later* needs the same treatment |

---

## 13. Assumptions this bundle makes

1. **One host, one app replica.** No load balancer, no second node; nginx proxies
   to `127.0.0.1:3000` on the same machine.
2. **Two hostnames** — the app on `$DOMAIN`, Supabase's API gateway on
   `$API_DOMAIN`. Serving the API under a path prefix on the app hostname would
   break the Supabase JS client's absolute `/auth/v1`, `/rest/v1` paths.
3. **Supabase stack = official `supabase/docker` compose files** with the Compose
   project name `supabase` (network `supabase_default`). The container list drifts
   between releases (current stacks run an Envoy gateway aliased as `kong`;
   older ones run Kong, plus analytics/vector containers) — nothing here depends on
   the exact count.
4. **TLS via certbot `--webroot`** on the stock distro nginx (1.22–1.26). The
   template keeps `listen 443 ssl http2` so it parses on all of them; on nginx ≥
   1.25.1 that logs a deprecation warning.
5. **Node 22 on the host** is only for `npx supabase` / build tooling — the app image
   is built from `node:22-alpine` inside Docker regardless (`package.json` requires
   `>=22.12.0`).
6. **SMTP is provided by you.** Without it, sign-up confirmation, password reset and
   invitations silently never arrive.
7. **No secret is in this bundle.** `.env.production`, `/srv/supabase/.env` and the
   certs are created on the host and must be backed up separately.
8. **`ufw` alone is not enough for Docker-published ports** — hence the loopback
   bindings in 7.3. If you prefer iptables rules, the `DOCKER-USER` chain is where
   they belong.
9. **A Hetzner Cloud Firewall, if attached, is configured separately** and takes
   precedence over `ufw`; allow 22/80/443 there too.
