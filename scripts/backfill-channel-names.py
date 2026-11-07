#!/usr/bin/env python3
"""One-off repair: give Messenger/Instagram contacts their real name.

The channel-name bug wrote the customer's FIRST MESSAGE into `contacts.name`
(the PSID profile lookup is blocked — 400 GraphMethodException — so the old
fallback used the message text). This fixes the rows that already exist.

    python3 scripts/backfill-channel-names.py            # dry run
    python3 scripts/backfill-channel-names.py --apply    # write the names

Runs ON THE PROD BOX: it shells out to `docker exec supabase-db psql` for the
data, reads ENCRYPTION_KEY from /srv/exbolt/.env.production to decrypt the Page
token, and calls Graph with `GET /{mid}?fields=from{id,name}` (the only lookup
that still returns a name). Tokens are never printed.

A row is repaired only when its stored name is provably not a name: blank,
equal to the raw channel id, or byte-identical to the first customer message.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

DB_CONTAINER = os.environ.get("SUPABASE_DB_CONTAINER", "supabase-db")
GRAPH_VERSION = os.environ.get("META_GRAPH_VERSION", "v23.0")
ENV_FILE = os.environ.get("EXBOLT_ENV_FILE", "/srv/exbolt/.env.production")
APPLY = "--apply" in sys.argv


def load_env(path: str) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                values[key.strip()] = value.strip().strip('"').strip("'")
    except OSError as err:
        sys.exit(f"cannot read {path}: {err}")
    return values


def psql(sql: str) -> list[list[str]]:
    out = subprocess.run(
        [
            "docker", "exec", "-i", DB_CONTAINER,
            "psql", "-U", "postgres", "-d", "postgres",
            "-At", "-F", "\t", "-c", sql,
        ],
        capture_output=True,
        text=True,
    )
    if out.returncode != 0:
        sys.exit(f"psql failed: {out.stderr.strip()[:400]}")
    rows = []
    for line in out.stdout.splitlines():
        if line.strip():
            rows.append(line.split("\t"))
    return rows


def sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def decrypt_token(payload: str, key: bytes) -> str:
    iv_hex, ct_hex, tag_hex = payload.split(":")
    return AESGCM(key).decrypt(
        bytes.fromhex(iv_hex), bytes.fromhex(ct_hex) + bytes.fromhex(tag_hex), None
    ).decode()


def graph(path: str, token: str) -> dict | None:
    url = f"https://graph.facebook.com/{GRAPH_VERSION}/{path}"
    sep = "&" if "?" in path else "?"
    url = f"{url}{sep}access_token={urllib.parse.quote(token)}"
    try:
        with urllib.request.urlopen(url, timeout=10) as res:
            return json.loads(res.read().decode())
    except Exception:
        return None


def sender_name(message_id: str, token: str) -> str | None:
    if not message_id:
        return None
    data = graph(f"{message_id}?fields=from{{id,name}}", token)
    name = ((data or {}).get("from") or {}).get("name") or ""
    return name.strip() or None


def label_for(channel: str, sender_id: str) -> str:
    return f"{'Instagram' if channel == 'instagram' else 'Messenger'} · {sender_id[-6:]}"


def main() -> None:
    env = load_env(ENV_FILE)
    key_hex = env.get("ENCRYPTION_KEY", "")
    if not key_hex:
        sys.exit(f"ENCRYPTION_KEY missing from {ENV_FILE}")
    key = bytes.fromhex(key_hex)

    tokens: dict[str, str] = {}
    for channel, token_enc in psql(
        "select channel, access_token from channel_configs where is_active;"
    ):
        try:
            tokens[channel] = decrypt_token(token_enc, key)
        except Exception as err:  # noqa: BLE001 — report and continue
            print(f"! token decrypt failed for {channel}: {err}")

    rows = psql(
        """
        select c.id, c.channel, c.channel_user_id,
               regexp_replace(coalesce(c.name, ''), '[\n\r\t]+', ' ', 'g'),
               regexp_replace(coalesce(f.content_text, ''), '[\n\r\t]+', ' ', 'g'),
               coalesce(f.message_id, ''), coalesce(l.message_id, '')
        from contacts c
        join conversations cv on cv.contact_id = c.id
        join lateral (
          select content_text, message_id from messages
          where conversation_id = cv.id and sender_type = 'customer'
          order by created_at asc limit 1
        ) f on true
        join lateral (
          select message_id from messages
          where conversation_id = cv.id and sender_type = 'customer'
          order by created_at desc limit 1
        ) l on true
        where c.channel in ('messenger', 'instagram')
        order by c.channel, c.created_at;
        """
    )

    scanned = candidates = renamed = failed = 0
    seen: set[str] = set()
    for contact_id, channel, sender_id, stored, first_text, first_mid, last_mid in rows:
        # A contact with two conversations appears twice in the join.
        if contact_id in seen:
            continue
        seen.add(contact_id)
        scanned += 1
        token = tokens.get(channel)
        if not token:
            failed += 1
            print(f"! no active token for {channel} (contact {contact_id})")
            continue

        stored = stored.strip()
        looks_like_message = bool(first_text.strip()) and stored == first_text.strip()
        if not (looks_like_message or stored == "" or stored == sender_id):
            continue

        candidates += 1
        resolved = sender_name(last_mid or first_mid, token) or label_for(channel, sender_id)

        if not APPLY:
            print(f'{channel} {sender_id}: "{stored[:60]}" -> "{resolved}"')
            continue

        out = subprocess.run(
            [
                "docker", "exec", "-i", DB_CONTAINER,
                "psql", "-U", "postgres", "-d", "postgres", "-At",
                "-c", f"update contacts set name = {sql_str(resolved)} where id = {sql_str(contact_id)};",
            ],
            capture_output=True,
            text=True,
        )
        if out.returncode != 0:
            failed += 1
            print(f"! update failed {contact_id}: {out.stderr.strip()[:200]}")
        else:
            renamed += 1
            print(f'updated {channel} {contact_id}: "{stored[:40]}" -> "{resolved}"')
        time.sleep(0.2)  # stay well inside Graph's per-page rate limit

    print(
        f"\n{'APPLIED' if APPLY else 'DRY RUN'} — scanned {scanned}, "
        f"candidates {candidates}, "
        f"{'renamed ' + str(renamed) if APPLY else 'would rename ' + str(candidates)}, "
        f"failed {failed}"
    )
    if not APPLY:
        print("re-run with --apply to write these names")


if __name__ == "__main__":
    main()
