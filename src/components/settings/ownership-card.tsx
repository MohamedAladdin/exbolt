"use client";

/**
 * Settings → صندوق الوارد → «ملكية المحادثة».
 *
 * Three questions, one card, because they are one decision — who is responsible
 * for an unassigned thread:
 *
 *   1. Does replying take it? (default on — whoever answers owns it)
 *   2. Does opening take it? (default off — reading is not a commitment)
 *   3. When nobody owns it, whose phone rings? (roles ∩ optional member list)
 *
 * The card saves straight to `accounts` under RLS (owner/admin only), like every
 * other inbox setting. Each switch carries the sentence that explains what stops
 * working when it is off — a toggle with no consequence written next to it is a
 * switch nobody dares touch.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { UserCheck, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Roles a person can claim or be alerted under. Viewers can read, never own. */
const CLAIM_ROLES = ["owner", "admin", "agent"] as const;

interface Member {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

interface OwnershipState {
  onReply: boolean;
  onOpen: boolean;
  claimRoles: string[];
  alertRoles: string[];
  /** null = every member holding the chosen roles. */
  alertMembers: string[] | null;
}

const ROLE_LABEL: Record<string, string> = {
  owner: "المالك",
  admin: "مسؤول",
  agent: "موظف",
};

export function OwnershipCard() {
  const t = useTranslations("Settings.inbox.ownership");
  const { accountId, canEditSettings, profileLoading } = useAuth();

  const [state, setState] = useState<OwnershipState | null>(null);
  const [saved, setSaved] = useState<OwnershipState | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const supabase = createClient();

    supabase
      .from("accounts")
      .select(
        "auto_claim_on_reply, auto_claim_on_open, auto_claim_roles, unassigned_alert_roles, unassigned_alert_members",
      )
      .eq("id", accountId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          toast.error(t("loadFailed"));
          return;
        }
        const next: OwnershipState = {
          onReply: data.auto_claim_on_reply !== false,
          onOpen: data.auto_claim_on_open === true,
          claimRoles: (data.auto_claim_roles ?? [...CLAIM_ROLES]) as string[],
          alertRoles: (data.unassigned_alert_roles ?? [...CLAIM_ROLES]) as string[],
          alertMembers: (data.unassigned_alert_members ?? null) as string[] | null,
        };
        setState(next);
        setSaved(next);
      });

    supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .eq("account_id", accountId)
      .is("blocked_at", null)
      .order("full_name")
      .then(({ data }) => {
        if (!cancelled) setMembers((data ?? []) as Member[]);
      });

    return () => {
      cancelled = true;
    };
  }, [accountId, t]);

  const dirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(saved),
    [state, saved],
  );

  function toggleRole(field: "claimRoles" | "alertRoles", role: string) {
    setState((prev) => {
      if (!prev) return prev;
      const has = prev[field].includes(role);
      // Never let the last role go: an empty list means "nobody can claim" and
      // reads on screen as a broken card, not as a deliberate lockdown.
      if (has && prev[field].length === 1) return prev;
      return {
        ...prev,
        [field]: has ? prev[field].filter((r) => r !== role) : [...prev[field], role],
      };
    });
  }

  function toggleMember(userId: string) {
    setState((prev) => {
      if (!prev) return prev;
      const current = prev.alertMembers ?? members.map((m) => m.user_id);
      const has = current.includes(userId);
      const next = has ? current.filter((id) => id !== userId) : [...current, userId];
      // All members selected is the same thing as NULL (no restriction).
      return { ...prev, alertMembers: next.length === members.length ? null : next };
    });
  }

  async function handleSave() {
    if (!accountId || !state || !dirty) return;
    setSaving(true);
    const { error } = await createClient()
      .from("accounts")
      .update({
        auto_claim_on_reply: state.onReply,
        auto_claim_on_open: state.onOpen,
        auto_claim_roles: state.claimRoles,
        unassigned_alert_roles: state.alertRoles,
        unassigned_alert_members: state.alertMembers,
      })
      .eq("id", accountId);
    setSaving(false);

    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    setSaved(state);
    toast.success(t("saved"));
  }

  if (!state) return null;

  const selectedMembers = state.alertMembers ?? members.map((m) => m.user_id);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <UserCheck className="size-4 text-muted-foreground" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <Label className="text-foreground">{t("onReply")}</Label>
            <p className="text-xs text-muted-foreground">{t("onReplyHint")}</p>
          </div>
          <Switch
            checked={state.onReply}
            disabled={!canEditSettings || profileLoading}
            onCheckedChange={(checked) => setState({ ...state, onReply: checked })}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <Label className="text-foreground">{t("onOpen")}</Label>
            <p className="text-xs text-muted-foreground">{t("onOpenHint")}</p>
          </div>
          <Switch
            checked={state.onOpen}
            disabled={!canEditSettings || profileLoading}
            onCheckedChange={(checked) => setState({ ...state, onOpen: checked })}
          />
        </div>

        <div className="grid gap-2">
          <Label className="text-foreground">{t("claimRoles")}</Label>
          <p className="text-xs text-muted-foreground">{t("claimRolesHint")}</p>
          <div className="flex flex-wrap gap-2">
            {CLAIM_ROLES.map((role) => {
              const active = state.claimRoles.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  disabled={!canEditSettings}
                  onClick={() => toggleRole("claimRoles", role)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {ROLE_LABEL[role] ?? role}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-2 border-t border-border pt-4">
          <Label className="text-foreground">{t("alertRoles")}</Label>
          <p className="text-xs text-muted-foreground">{t("alertRolesHint")}</p>
          <div className="flex flex-wrap gap-2">
            {CLAIM_ROLES.map((role) => {
              const active = state.alertRoles.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  disabled={!canEditSettings}
                  onClick={() => toggleRole("alertRoles", role)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {ROLE_LABEL[role] ?? role}
                </button>
              );
            })}
          </div>

          {members.length > 1 && (
            <div className="mt-2 grid gap-2">
              <Label className="text-xs text-muted-foreground">{t("members")}</Label>
              <div className="flex flex-wrap gap-2">
                {members.map((member) => {
                  const active = selectedMembers.includes(member.user_id);
                  return (
                    <button
                      key={member.user_id}
                      type="button"
                      disabled={!canEditSettings}
                      onClick={() => toggleMember(member.user_id)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        active
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {member.full_name || member.email || member.user_id.slice(0, 6)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {canEditSettings ? t("footnote") : t("adminOnly")}
        </p>

        {canEditSettings && (
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("saving")}
              </>
            ) : (
              t("save")
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
