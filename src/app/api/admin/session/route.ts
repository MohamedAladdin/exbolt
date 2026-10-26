/**
 * "Am I a platform admin?" — used by the tenant sidebar to show (or hide)
 * the link into `/admin`. Never returns anything but a boolean: the panel
 * itself re-checks on every page and every route.
 */

import { NextResponse } from "next/server";

import { isPlatformAdmin } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await isPlatformAdmin();
  return NextResponse.json({ admin }, { headers: { "cache-control": "no-store" } });
}
