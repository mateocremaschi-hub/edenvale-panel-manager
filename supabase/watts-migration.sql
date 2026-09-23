-- Nominal watt class per panel (535 / 540 / 545), from the master Excel's "Pnom (W)" column.
-- This is the electrical datum the field team actually uses; Vmp voltage stays for history but
-- is no longer surfaced in the app. Populated by Settings -> "Load panel Watts from master Excel"
-- (a serial-matched enrichment that never touches serials, statuses or locations).
alter table panels add column if not exists watt_class integer;

-- Watt class of the panel installed by a replacement (replaces the old voltage capture).
alter table replacements add column if not exists new_power_w integer;
