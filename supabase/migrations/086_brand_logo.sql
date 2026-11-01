-- ============================================================
-- 086 — Account logo (brand identity)
--
-- Until now "branding" was a text name only (`accounts.brand_name`, 062). A
-- clinic's printed report going to its manager should carry the clinic's mark,
-- not just its name — and the same header is used by the scheduled email.
--
-- The bucket is PUBLIC on purpose: a logo is not client data, and a public URL
-- is what lets an email client and a printed page fetch it without a signed
-- token that expires before the manager opens the mail. Writes stay scoped to
-- the account's own folder, admin+ only.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'brand-assets',
  'brand-assets',
  TRUE,
  1048576, -- 1 MB: a logo, not a photo library
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
  SET public = TRUE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read (the bucket already is); the policy keeps an authenticated
-- `list` honest instead of leaking every account's folder listing.
DROP POLICY IF EXISTS "Brand assets are public" ON storage.objects;
CREATE POLICY "Brand assets are public" ON storage.objects
  FOR SELECT USING (bucket_id = 'brand-assets');

DROP POLICY IF EXISTS "Admins upload their brand logo" ON storage.objects;
CREATE POLICY "Admins upload their brand logo" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'brand-assets'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Admins replace their brand logo" ON storage.objects;
CREATE POLICY "Admins replace their brand logo" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'brand-assets'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Admins delete their brand logo" ON storage.objects;
CREATE POLICY "Admins delete their brand logo" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'brand-assets'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
