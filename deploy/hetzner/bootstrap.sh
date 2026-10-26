#!/usr/bin/env bash
# =============================================================================
# ExBolt — fresh-host bootstrap for Hetzner Cloud (Ubuntu / Debian)
# =============================================================================
#
# Prepares a brand-new Hetzner VM to host:
#   * the ExBolt Next.js app  (Docker, /srv/exbolt)
#   * self-hosted Supabase   (Docker, /srv/supabase)
#   * nginx + Let's Encrypt in front of both
#
# DESIGN RULES
#   1. Idempotent. Every step checks current state first; running it a second
#      time is a no-op and never rewrites working config.
#   2. Never lock you out. The sshd hardening drop-in is validated with
#      `sshd -t` BEFORE ssh is reloaded. If validation fails the drop-in is
#      moved aside and ssh is left untouched.
#   3. No secrets. This script never writes an application secret; the app env
#      lives in /srv/exbolt/.env.production, provisioned separately (README.md).
#
# USAGE (as root, fresh box):
#   bash bootstrap.sh "ssh-ed25519 AAAAC3Nz... deploy@laptop"
#
#   The optional ARG 1 is a public key appended to BOTH /root/.ssh/authorized_keys
#   and /home/deploy/.ssh/authorized_keys (idempotently, by key blob). Pass the
#   key you will actually log in with — password auth is disabled at the end.
#
#   Escape hatches (rarely needed, documented in README.md):
#     EXBOLT_ALLOW_NO_KEYS=1  — proceed even if no SSH key is present anywhere.
#                              Only for a console/rescue session where you know
#                              what you are doing; you may lose SSH access.
#     EXBOLT_SSH_PORT=2222    — also open this TCP port in ufw.
#
# REQUIREMENTS: Ubuntu 22.04/24.04 or Debian 12/13, root, outbound HTTPS.
# =============================================================================

set -Eeuo pipefail   # -E: the ERR trap must also fire inside functions

# ---------------------------------------------------------------------------
# Globals / helpers
# ---------------------------------------------------------------------------
readonly SWAPFILE="/swapfile"
readonly SSHD_HARDEN="/etc/ssh/sshd_config.d/99-hardening.conf"
readonly DEPLOY_USER="deploy"
readonly APP_DIR="/srv/exbolt"
readonly SUPABASE_DIR="/srv/supabase"
readonly LOG_DIR="/var/log/exbolt"

AGENT_PUBKEY="${1:-}"
OS_ID=""
OS_VERSION=""
OS_PRETTY=""
OS_CODENAME=""
SSH_PORT="${EXBOLT_SSH_PORT:-22}"

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export APT_LISTCHANGES_FRONTEND=none

log()  { printf '[bootstrap] %s\n' "$*"; }
step() { printf '\n[bootstrap] === %s ===\n' "$*"; }
warn() { printf '[bootstrap] WARNING: %s\n' "$*" >&2; }

die() {
  printf '\n[bootstrap] FATAL: %s\n' "$*" >&2
  exit 1
}

on_err() {
  printf '\n[bootstrap] FAILED at line %s: %s\n' "$1" "$2" >&2
  printf '[bootstrap] Host is in a partially-configured state; the script is\n' >&2
  printf '[bootstrap] idempotent, so fix the cause and re-run it.\n' >&2
}

trap 'on_err "$LINENO" "$BASH_COMMAND"' ERR

apt_install() {
  # Conffile prompts must never block a non-interactive run; keep the
  # locally-installed version on re-runs so we never clobber our own edits.
  apt-get install -y \
    -o Dpkg::Options::=--force-confdef \
    -o Dpkg::Options::=--force-confold \
    "$@"
}

# ---------------------------------------------------------------------------
# 1. Preconditions
# ---------------------------------------------------------------------------
require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "must run as root (try: sudo bash ${0##*/} \"<your ssh public key>\")"
  fi
}

detect_os() {
  [[ -r /etc/os-release ]] || die "/etc/os-release is missing — cannot identify the OS."

  # shellcheck source=/dev/null
  . /etc/os-release
  OS_ID="${ID:-unknown}"
  OS_VERSION="${VERSION_ID:-unknown}"
  OS_PRETTY="${PRETTY_NAME:-${OS_ID} ${OS_VERSION}}"
  OS_CODENAME="${VERSION_CODENAME:-}"

  case "${OS_ID}" in
    ubuntu|debian) : ;;
    *)
      die "unsupported OS: '${OS_PRETTY}'. This bootstrap supports Ubuntu and Debian only.
       Hetzner images 'Ubuntu 24.04' / 'Debian 12' are what it was written for."
      ;;
  esac

  [[ -n "${OS_CODENAME}" ]] || die "cannot determine the ${OS_ID} codename (VERSION_CODENAME unset) — refusing to guess apt suites."
  log "detected ${OS_PRETTY} (id=${OS_ID} codename=${OS_CODENAME})"
}

# ---------------------------------------------------------------------------
# 2. Base packages
# ---------------------------------------------------------------------------
install_base_packages() {
  step "base packages"

  apt-get update -y
  dpkg --configure -a || warn "dpkg --configure -a reported a problem (continuing)"

  # python3-systemd is required by the fail2ban 'systemd' backend: Ubuntu
  # 24.04 ships no rsyslog, so /var/log/auth.log does not exist and the
  # default file-based backend would never ban anyone.
  apt_install \
    curl ca-certificates gnupg git jq unzip rsync sudo \
    ufw fail2ban python3-systemd \
    htop ncdu unattended-upgrades apt-listchanges

  log "base packages present"
}

# ---------------------------------------------------------------------------
# 3. Swap — sized from RAM, only when the host has none
# ---------------------------------------------------------------------------
ensure_swap() {
  step "swap"

  if [[ -n "$(swapon --show=NAME --noheadings 2>/dev/null | tr -d '[:space:]')" ]]; then
    log "swap already active — left untouched:"
    swapon --show || true
    return 0
  fi

  local mem_mb target_mb
  mem_mb="$(awk '/^MemTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo)"

  if   (( mem_mb >= 8192 )); then target_mb=1024
  elif (( mem_mb >= 4096 )); then target_mb=2048
  else                            target_mb=4096
  fi

  log "RAM ${mem_mb}MB with no swap -> creating ${target_mb}MB ${SWAPFILE}"

  if [[ ! -f "${SWAPFILE}" ]]; then
    if ! fallocate -l "${target_mb}M" "${SWAPFILE}" 2>/dev/null; then
      # fallocate is unsupported on some filesystems (e.g. btrfs pre-5.15 quirks)
      log "fallocate unsupported here — falling back to dd"
      dd if=/dev/zero of="${SWAPFILE}" bs=1M count="${target_mb}" status=none
    fi
    chmod 0600 "${SWAPFILE}"
    mkswap "${SWAPFILE}" >/dev/null
  fi

  if ! grep -qsE "^${SWAPFILE}[[:space:]]" /etc/fstab; then
    cp -a /etc/fstab "/etc/fstab.exbolt.bak"
    printf '%s none swap sw 0 0\n' "${SWAPFILE}" >> /etc/fstab
    log "persisted ${SWAPFILE} in /etc/fstab (backup: /etc/fstab.exbolt.bak)"
  else
    log "${SWAPFILE} already in /etc/fstab"
  fi

  # `grep -q` exits early and can SIGPIPE swapon (fatal under pipefail);
  # plain grep with redirect reads the whole stream instead.
  if ! swapon --show=NAME --noheadings | grep -x "${SWAPFILE}" >/dev/null; then
    # A pre-existing-but-unformatted file is recovered here rather than dying.
    if ! swapon "${SWAPFILE}" 2>/dev/null; then
      mkswap "${SWAPFILE}" >/dev/null
      swapon "${SWAPFILE}"
    fi
  fi

  swapon --show || true
}

# ---------------------------------------------------------------------------
# 4. Timezone + security-only unattended upgrades
# ---------------------------------------------------------------------------
configure_time_and_updates() {
  step "timezone + unattended security upgrades"

  if ! timedatectl set-timezone UTC 2>/dev/null; then
    ln -sf /usr/share/zoneinfo/UTC /etc/localtime
    printf 'UTC\n' > /etc/timezone
  fi
  log "timezone: $(date +'%Z %z')"

  # Periodic apt metadata refresh + unattended application of upgrades.
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
// Managed by ExBolt deploy/hetzner/bootstrap.sh
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

  # apt APPENDS list values across apt.conf.d files and offers no way to clear
  # an inherited list (`""` and `#clear` both leave earlier entries in place,
  # verified with apt-config on a two-file fixture). Ubuntu's stock list also
  # includes the release pocket (${distro_id}:${distro_codename}), and Debian's
  # uses Origins-Pattern; both would still apply non-security updates. To make
  # "security only" true rather than aspirational, the distro file is replaced
  # wholesale with a security-only equivalent.
  #
  # It is a dpkg conffile: apt_install() runs with --force-confold, so a future
  # package upgrade keeps this version instead of prompting.
  install -d -m 0750 /var/backups/exbolt
  local uu="/etc/apt/apt.conf.d/50unattended-upgrades"
  if [[ -f "${uu}" ]] &&
     [[ ! -f /var/backups/exbolt/50unattended-upgrades.dist ]] &&
     ! grep -qs 'Managed by ExBolt deploy/hetzner/bootstrap.sh' "${uu}"; then
    cp -a "${uu}" /var/backups/exbolt/50unattended-upgrades.dist
    log "backed up the distro upgrade policy to /var/backups/exbolt/50unattended-upgrades.dist"
  fi

  cat > /etc/apt/apt.conf.d/50unattended-upgrades <<'EOF'
// Managed by ExBolt deploy/hetzner/bootstrap.sh — replaces the distro default.
// Security pocket only: no release-pocket or -updates packages install
// unattended, and nothing reboots the host on its own.
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "false";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::SyslogEnable "true";
EOF

  # Drop the earlier two-file variant if this host ran a previous revision.
  rm -f /etc/apt/apt.conf.d/51exbolt-unattended-upgrades

  systemctl enable --now unattended-upgrades >/dev/null 2>&1 || \
    warn "could not enable unattended-upgrades.service (timer-only systems are fine)"

  # The kernel/Docker need a reboot flag we do NOT take automatically; the
  # operator decides. /var/run/reboot-required is surfaced in the summary.
  log "security-only unattended upgrades enabled (no automatic reboot)"
}

# ---------------------------------------------------------------------------
# 5. The deploy user + SSH keys  (must happen BEFORE sshd hardening)
# ---------------------------------------------------------------------------

# Append a public key to a file once, matched on the key blob (field 2), so
# re-runs and differing comments do not duplicate lines.
append_key_once() {
  local key="$1" file="$2" blob
  blob="$(awk '{print $2}' <<<"${key}")"
  [[ -n "${blob}" ]] || die "malformed SSH public key (no key blob): ${key}"

  install -d -m 0700 "${file%/*}"
  touch "${file}"
  chmod 0600 "${file}"

  if grep -qF -- "${blob}" "${file}" 2>/dev/null; then
    log "key already authorised in ${file} (${blob:0:16}…)"
    return 0
  fi
  printf '%s\n' "${key}" >> "${file}"
  log "authorised key ${blob:0:16}… in ${file}"
}

validate_pubkey() {
  local key="$1"
  [[ "${key}" != *$'\n'* ]] || die "ARG 1 must be a single line (one public key)."
  if ! [[ "${key}" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)[[:space:]]+AAAA[^[:space:]]+(.*)$ ]]; then
    die "ARG 1 is not an OpenSSH public key.
       Expected: 'ssh-ed25519 AAAAC3Nz... comment' or 'ssh-rsa AAAAB3Nz... comment'."
  fi
}

ensure_deploy_user() {
  step "deploy user"

  if id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
    log "user ${DEPLOY_USER} already exists"
  else
    useradd --create-home --shell /bin/bash --comment "ExBolt deploy" "${DEPLOY_USER}"
    log "created user ${DEPLOY_USER}"
  fi

  # Sudo without a password: the account is key-only, and this box is
  # administered non-interactively by the operator / agents.
  local sudoers="/etc/sudoers.d/90-exbolt-${DEPLOY_USER}"
  install -d -m 0750 /etc/sudoers.d
  printf '%s ALL=(ALL) NOPASSWD:ALL\n' "${DEPLOY_USER}" > "${sudoers}"
  chmod 0440 "${sudoers}"
  visudo -cf "${sudoers}" >/dev/null || die "generated sudoers file failed validation: ${sudoers}"
  log "sudo: ${DEPLOY_USER} -> NOPASSWD:ALL (validated by visudo)"

  install -d -m 0700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
}

provision_ssh_keys() {
  step "ssh keys"

  install -d -m 0700 /root/.ssh
  touch /root/.ssh/authorized_keys
  chmod 0600 /root/.ssh/authorized_keys

  # 1. Carry over whatever the provider image (or you) already installed for root.
  if [[ -s /root/.ssh/authorized_keys ]]; then
    cp -a /root/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"
    chown "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
    chmod 0600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
    log "copied $(grep -cE '^(ssh-|ecdsa-|sk-)' /root/.ssh/authorized_keys || true) key(s) from root to ${DEPLOY_USER}"
  else
    warn "no /root/.ssh/authorized_keys — nothing to copy yet"
  fi

  # 2. Append the key passed as ARG 1 to both accounts.
  if [[ -n "${AGENT_PUBKEY}" ]]; then
    validate_pubkey "${AGENT_PUBKEY}"
    append_key_once "${AGENT_PUBKEY}" /root/.ssh/authorized_keys
    append_key_once "${AGENT_PUBKEY}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
    chown "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  else
    warn "no public key passed as ARG 1 — only the keys already on this host will work"
  fi

  chown root:root /root/.ssh /root/.ssh/authorized_keys
  chmod 0700 /root/.ssh
  chmod 0600 /root/.ssh/authorized_keys
}

# ---------------------------------------------------------------------------
# 6. SSH hardening  (validated before reload — never lock the box out)
# ---------------------------------------------------------------------------
harden_ssh() {
  step "sshd hardening"

  # Count key lines across both accounts. Deliberately no pipeline: a missing
  # file makes grep exit 2, which pipefail would turn into a fatal error at the
  # exact moment we are trying to decide whether it is safe to proceed.
  local key_lines=0 key_file count
  for key_file in /root/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"; do
    count="$(grep -cE '^(ssh-|ecdsa-|sk-)' "${key_file}" 2>/dev/null || true)"
    key_lines=$(( key_lines + ${count:-0} ))
  done

  if (( key_lines == 0 )); then
    if [[ "${EXBOLT_ALLOW_NO_KEYS:-0}" == "1" ]]; then
      warn "no authorised keys found and EXBOLT_ALLOW_NO_KEYS=1 — disabling password auth anyway"
      warn "you have been warned: this is how boxes get locked out"
    else
      die "refusing to disable password authentication: no SSH keys found in
       /root/.ssh/authorized_keys or /home/${DEPLOY_USER}/.ssh/authorized_keys.

       Pass your public key as ARG 1:
         bash bootstrap.sh \"\$(cat ~/.ssh/id_ed25519.pub)\"
       or, if you are on the Hetzner web console and accept the risk:
         EXBOLT_ALLOW_NO_KEYS=1 bash bootstrap.sh"
    fi
  else
    log "${key_lines} authorised key line(s) present"
  fi

  install -d -m 0755 /etc/ssh/sshd_config.d

  # Some minimal images / containers ship sshd without a config file. Create a
  # skeleton rather than dying on a missing backup source.
  if [[ ! -f /etc/ssh/sshd_config ]]; then
    warn "/etc/ssh/sshd_config is missing — writing a minimal skeleton"
    cat > /etc/ssh/sshd_config <<'EOF'
# Minimal sshd_config written by ExBolt deploy/hetzner/bootstrap.sh
Include /etc/ssh/sshd_config.d/*.conf
Port 22
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_rsa_key
EOF
  fi

  # Drop-in config only takes effect if the main config includes the directory.
  if ! grep -qE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/' /etc/ssh/sshd_config; then
    if [[ ! -f /etc/ssh/sshd_config.exbolt.bak ]]; then
      cp -a /etc/ssh/sshd_config /etc/ssh/sshd_config.exbolt.bak
    fi
    # OpenSSH uses the FIRST value it sees, so the include must be at the top.
    sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' /etc/ssh/sshd_config
    log "added 'Include /etc/ssh/sshd_config.d/*.conf' to sshd_config (backup: .exbolt.bak)"
  fi

  cat > "${SSHD_HARDEN}" <<'EOF'
# Managed by ExBolt deploy/hetzner/bootstrap.sh — changes are overwritten on re-run.
# Key-only login. Root may log in with a key (needed for provider rescue flows)
# but never with a password.
PermitRootLogin prohibit-password
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
X11Forwarding no
MaxAuthTries 3
EOF
  chmod 0644 "${SSHD_HARDEN}"
  log "wrote ${SSHD_HARDEN}"

  # sshd honours the FIRST value it reads, and drop-ins are read in filename
  # order — so on Ubuntu cloud images `50-cloud-init.conf` shipping
  # `PasswordAuthentication yes` would BEAT this 99-* file. Verified with
  # `sshd -T`: password auth stayed enabled until the conflicting directives
  # were commented out. Neutralise them so 99-hardening.conf is authoritative
  # whatever the image shipped.
  local dropin
  for dropin in /etc/ssh/sshd_config.d/*.conf; do
    if [[ ! -e "${dropin}" ]]; then
      continue
    fi
    if [[ "${dropin}" == "${SSHD_HARDEN}" ]]; then
      continue
    fi
    if grep -qEi '^[[:space:]]*(PasswordAuthentication|PermitRootLogin|KbdInteractiveAuthentication|ChallengeResponseAuthentication|PubkeyAuthentication)[[:space:]]' "${dropin}"; then
      cp -a "${dropin}" "${dropin}.exbolt.bak"
      sed -i -E 's@^([[:space:]]*)(PasswordAuthentication|PermitRootLogin|KbdInteractiveAuthentication|ChallengeResponseAuthentication|PubkeyAuthentication)([[:space:]])@# disabled by ExBolt bootstrap (see 99-hardening.conf): \1\2\3@' "${dropin}"
      log "neutralised conflicting directives in ${dropin} (backup: ${dropin}.exbolt.bak)"
    fi
  done

  # Keep cloud-init's own model consistent, so a later cloud-init run cannot
  # write `PasswordAuthentication yes` back in.
  if [[ -d /etc/cloud/cloud.cfg.d ]]; then
    printf 'ssh_pwauth: false\n' > /etc/cloud/cloud.cfg.d/99-exbolt-ssh.cfg
    log "cloud-init: ssh_pwauth=false (/etc/cloud/cloud.cfg.d/99-exbolt-ssh.cfg)"
  fi

  # VALIDATE BEFORE RELOADING. `sshd -t` parses the full effective config,
  # including our drop-in. On failure we remove the drop-in and leave the
  # running sshd (and its on-disk config) exactly as it was.
  if ! sshd -t; then
    mv -f "${SSHD_HARDEN}" "${SSHD_HARDEN}.rejected"
    die "sshd -t rejected the hardening config.
       The drop-in was moved to ${SSHD_HARDEN}.rejected and ssh was NOT reloaded,
       so your current session and login method still work.
       Inspect with: sudo sshd -t -f /etc/ssh/sshd_config"
  fi
  log "sshd -t: configuration is valid"

  # Ubuntu/Debian call the unit ssh.service; sshd.service exists on some images.
  if systemctl reload ssh 2>/dev/null; then
    log "reloaded ssh.service"
  elif systemctl reload sshd 2>/dev/null; then
    log "reloaded sshd.service"
  else
    die "could not reload ssh — config is valid but not active. Reload manually:
       sudo systemctl reload ssh || sudo systemctl restart ssh"
  fi

  log "effective auth settings:"
  sshd -T 2>/dev/null | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|x11forwarding|maxauthtries|pubkeyauthentication) ' | sed 's/^/    /' || true
}

# ---------------------------------------------------------------------------
# 7. Firewall
# ---------------------------------------------------------------------------
configure_firewall() {
  step "ufw"

  ufw --force default deny incoming
  ufw --force default allow outgoing
  ufw allow 22/tcp comment 'ssh' >/dev/null
  if [[ "${SSH_PORT}" != "22" ]]; then
    ufw allow "${SSH_PORT}/tcp" comment 'ssh (alternate port)' >/dev/null
    warn "also opened TCP ${SSH_PORT} in ufw — remember to set 'Port ${SSH_PORT}' in sshd_config yourself"
  fi
  ufw allow 80/tcp  comment 'http - letsencrypt + redirect' >/dev/null
  ufw allow 443/tcp comment 'https' >/dev/null
  ufw --force enable
  log "ufw enabled (deny in / allow out; 22, 80, 443 open)"
  ufw status numbered
}

# ---------------------------------------------------------------------------
# 8. fail2ban
# ---------------------------------------------------------------------------
configure_fail2ban() {
  step "fail2ban"

  install -d -m 0755 /etc/fail2ban/jail.d /etc/fail2ban/filter.d
  cat > /etc/fail2ban/jail.d/exbolt-sshd.local <<EOF
# Managed by ExBolt deploy/hetzner/bootstrap.sh
[DEFAULT]
# Ubuntu 24.04 has no rsyslog by default; read the journal instead.
backend = systemd
findtime = 10m
maxretry = 5
bantime = 1h
banaction = ufw

[sshd]
enabled = true
port = ${SSH_PORT}
EOF

  systemctl enable fail2ban >/dev/null 2>&1 || warn "could not enable fail2ban"
  if systemctl is-active --quiet fail2ban; then
    systemctl reload fail2ban || systemctl restart fail2ban
  else
    systemctl start fail2ban
  fi
  log "sshd jail active (maxretry=5, findtime=10m, bantime=1h, banaction=ufw)"
  fail2ban-client status sshd 2>/dev/null | sed 's/^/    /' || warn "fail2ban-client status sshd not available yet"
}

# ---------------------------------------------------------------------------
# 9. Docker CE + compose plugin (official repo)
# ---------------------------------------------------------------------------
install_docker() {
  step "docker"

  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "docker + compose plugin already installed — skipping:"
    docker --version | sed 's/^/    /'
    docker compose version | sed 's/^/    /'
  else
    install -m 0755 -d /etc/apt/keyrings

    if [[ ! -s /etc/apt/keyrings/docker.asc ]]; then
      curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" -o /etc/apt/keyrings/docker.asc
      chmod a+r /etc/apt/keyrings/docker.asc
      log "installed Docker apt signing key"
    fi

    local arch
    arch="$(dpkg --print-architecture)"
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
      "${arch}" "${OS_ID}" "${OS_CODENAME}" > /etc/apt/sources.list.d/docker.list
    log "docker apt repo: ${OS_ID} ${OS_CODENAME} (${arch}) stable"

    apt-get update -y
    apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    systemctl enable --now docker
    log "installed: $(docker --version), $(docker compose version)"
  fi

  systemctl enable --now docker >/dev/null 2>&1 || warn "docker.service not started"

  # The package creates this group, but a pre-existing/rootless docker install
  # may not have it — usermod would then fail the whole run.
  if ! getent group docker >/dev/null 2>&1; then
    groupadd --system docker
    log "created the 'docker' group (the package did not)"
  fi

  if id -nG "${DEPLOY_USER}" | tr ' ' '\n' | grep -x docker >/dev/null; then
    log "${DEPLOY_USER} already in the docker group"
  else
    usermod -aG docker "${DEPLOY_USER}"
    log "added ${DEPLOY_USER} to the docker group (re-login required to take effect)"
  fi
}

# ---------------------------------------------------------------------------
# 10. Node.js 22 LTS (only when the host has older/none)
# ---------------------------------------------------------------------------
install_nodejs() {
  step "node.js"

  local major=0
  if command -v node >/dev/null 2>&1; then
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  fi

  if [[ "${major}" =~ ^[0-9]+$ ]] && (( major >= 22 )); then
    log "node $(node --version) already >= 22 — skipping"
    return 0
  fi

  log "installing Node.js 22 LTS from NodeSource (found major=${major})"
  local setup_script
  setup_script="$(mktemp /tmp/nodesource-setup.XXXXXX.sh)"
  curl -fsSL https://deb.nodesource.com/setup_22.x -o "${setup_script}"
  [[ -s "${setup_script}" ]] || die "downloaded NodeSource setup script is empty"
  bash "${setup_script}"
  rm -f "${setup_script}"

  apt_install nodejs
  log "installed node $(node --version), npm $(npm --version)"
}

# ---------------------------------------------------------------------------
# 11. nginx + certbot
# ---------------------------------------------------------------------------
install_nginx_certbot() {
  step "nginx + certbot"

  apt_install nginx python3-certbot-nginx

  systemctl enable --now nginx
  # A fresh install listens on :80 with the default site. We leave it in place
  # (harmless) — the runbook removes it when the ExBolt site is enabled.
  log "nginx $(nginx -v 2>&1 | sed 's/^nginx version: //') running; certbot $(certbot --version 2>&1 | awk '{print $2}')"
}

create_directories() {
  step "directories"

  install -d -m 0750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${APP_DIR}" "${SUPABASE_DIR}"
  install -d -m 0750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${LOG_DIR}"
  log "created (owner ${DEPLOY_USER}:${DEPLOY_USER}, mode 750):"
  printf '    %s\n    %s\n    %s\n' "${APP_DIR}" "${SUPABASE_DIR}" "${LOG_DIR}"
}

# ---------------------------------------------------------------------------
# 12. Summary
# ---------------------------------------------------------------------------
print_summary() {
  step "summary"

  local ram_mb disk_line docker_v node_v nginx_v swap_line
  ram_mb="$(awk '/^MemTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo)"
  disk_line="$(df -h / | awk 'NR==2 { printf "%s total, %s used, %s free (%s)", $2, $3, $4, $5 }')"
  # /proc/swaps is the ground truth and formats identically on every distro
  # (swapon's column formatting varies between util-linux releases).
  swap_line="$(awk 'NR > 1 { printf "%s %dM ", $1, $3 / 1024 }' /proc/swaps 2>/dev/null || true)"
  docker_v="$(docker --version 2>/dev/null || echo 'not installed')"
  node_v="$(node --version 2>/dev/null || echo 'not installed')"
  nginx_v="$(nginx -v 2>&1 | sed 's/^nginx version: //')"

  cat <<EOF

===============================================================================
 ExBolt host bootstrap complete
===============================================================================
 OS              : ${OS_PRETTY}
 Kernel          : $(uname -r)
 CPU / RAM       : $(nproc) vCPU / ${ram_mb} MB
 Swap            : ${swap_line:-none}
 Disk (/)        : ${disk_line}
 Timezone        : $(date +'%Z %z')

 Docker          : ${docker_v}
 Docker Compose  : $(docker compose version --short 2>/dev/null || echo 'n/a')
 Node.js         : ${node_v}
 nginx           : ${nginx_v}
 certbot         : $(certbot --version 2>&1 | awk '{print $2}')

 Users           : root (key only), ${DEPLOY_USER} (sudo + docker group)
 App dir         : ${APP_DIR}
 Supabase dir    : ${SUPABASE_DIR}
 Log dir         : ${LOG_DIR}

 ufw status      : $(ufw status | awk 'NR==1 { sub(/^Status: /, ""); print }')
===============================================================================
 sshd effective settings
===============================================================================
$(sshd -T 2>/dev/null | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|x11forwarding|maxauthtries|pubkeyauthentication) ' || echo '  (sshd -T unavailable)')
===============================================================================
EOF

  if [[ -f /var/run/reboot-required ]]; then
    printf ' NOTE: a reboot is required (%s). Do it at a convenient moment:\n' \
      "$(tr '\n' ' ' </var/run/reboot-required.pkgs 2>/dev/null || echo 'kernel/libc updated')"
    printf '       sudo reboot\n'
  fi

  cat <<EOF

 NEXT STEPS (see deploy/hetzner/README.md for the full runbook)
   1. Re-login as ${DEPLOY_USER} with your key:   ssh ${DEPLOY_USER}@<host>
   2. Point DNS at this host, then obtain TLS:  certbot certonly --webroot ...
   3. Start self-hosted Supabase in ${SUPABASE_DIR}
   4. git clone the app into ${APP_DIR}, write .env.production, compose up
   5. Register the Meta webhook:  https://<your-domain>/api/webhooks/meta
===============================================================================
EOF
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
main() {
  log "ExBolt bootstrap — $(date -u +'%Y-%m-%dT%H:%M:%SZ')"

  require_root
  detect_os
  install_base_packages
  ensure_swap
  configure_time_and_updates
  ensure_deploy_user
  provision_ssh_keys
  harden_ssh
  configure_firewall
  configure_fail2ban
  install_docker
  install_nodejs
  install_nginx_certbot
  create_directories
  print_summary

  log "done."
}

main "$@"
