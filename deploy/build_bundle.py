#!/usr/bin/env python3
"""Bundle all wacrm migrations into one SQL file for the Supabase SQL editor."""
import pathlib

root = pathlib.Path("/home/maladdin/rado-yard/wacrm")
src = sorted((root / "supabase/migrations").glob("*.sql"))
out = root / "deploy/hc-cloudwa-migrations.sql"
parts = [
    f"-- wacrm migrations bundle ({len(src)} files, in order) — apply to a fresh Supabase project.",
    "-- Generated from supabase/migrations/*.sql. Idempotent where the source files are.",
    "",
]
for f in src:
    parts.append(f"-- ============================================================")
    parts.append(f"-- FILE: {f.name}")
    parts.append(f"-- ============================================================")
    parts.append(f.read_text(encoding="utf-8").rstrip())
    parts.append("")
out.write_text("\n".join(parts), encoding="utf-8")
print("files:", len(src))
print("written:", out, out.stat().st_size, "bytes")
