ALTER TABLE tenants
  ADD COLUMN move_out_date date DEFAULT NULL AFTER move_in_date;
