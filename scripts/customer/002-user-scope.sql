-- Apply using the same restricted application role that owns the v1 tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_data','customer_imports','customer_order_links'] LOOP
    EXECUTE format('CREATE POLICY bolt_authenticated_owner ON %I TO CURRENT_USER USING (user_id = nullif(current_setting(''bolt.customer_id'', true), '''')) WITH CHECK (user_id = nullif(current_setting(''bolt.customer_id'', true), ''''))', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
UPDATE customer_schema SET version=2, migrated_at=now() WHERE id=1 AND version=1;
