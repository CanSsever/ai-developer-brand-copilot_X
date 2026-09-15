-- Remove direct access until explicit tenant policies are evaluated.
REVOKE ALL ON TABLE public."User" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public."Project" FROM PUBLIC, anon, authenticated;

-- Signed-in clients may only read their application ownership root.
GRANT SELECT ON TABLE public."User" TO authenticated;

-- Signed-in clients may manage only projects owned by their auth subject.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Project" TO authenticated;

ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Project" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own"
ON public."User"
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = id);

CREATE POLICY "projects_select_own"
ON public."Project"
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = "userId");

CREATE POLICY "projects_insert_own"
ON public."Project"
FOR INSERT
TO authenticated
WITH CHECK ((SELECT auth.uid()) = "userId");

CREATE POLICY "projects_update_own"
ON public."Project"
FOR UPDATE
TO authenticated
USING ((SELECT auth.uid()) = "userId")
WITH CHECK ((SELECT auth.uid()) = "userId");

CREATE POLICY "projects_delete_own"
ON public."Project"
FOR DELETE
TO authenticated
USING ((SELECT auth.uid()) = "userId");
