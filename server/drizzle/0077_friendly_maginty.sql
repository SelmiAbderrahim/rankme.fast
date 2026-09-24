DO $$
DECLARE
  duplicate_order_count bigint;
BEGIN
  SELECT count(*)
  INTO duplicate_order_count
  FROM (
    SELECT polar_order_id
    FROM invoices
    WHERE polar_order_id IS NOT NULL
    GROUP BY polar_order_id
    HAVING count(*) > 1
  ) duplicate_orders;

  IF duplicate_order_count > 0 THEN
    RAISE EXCEPTION
      'cannot enforce unique Polar order identity: invoices contains % duplicate non-null order ids; reconcile those financial records before retrying migration 0077',
      duplicate_order_count;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_polar_order_id_uidx" ON "invoices" USING btree ("polar_order_id");
