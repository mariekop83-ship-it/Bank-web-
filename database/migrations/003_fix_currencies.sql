-- Migration 003: ensure base currencies exist (fixes foreign key failure on account creation)
INSERT IGNORE INTO currencies (code, name, symbol, minor_units, is_supported, partner_available, partner_name, sort_order) VALUES
  ('USD', 'US Dollar', '$', 2, 1, 0, NULL, 1),
  ('EUR', 'Euro', '€', 2, 1, 0, NULL, 2),
  ('GBP', 'British Pound', '£', 2, 1, 0, NULL, 3),
  ('NGN', 'Nigerian Naira', '₦', 2, 1, 0, NULL, 4),
  ('CAD', 'Canadian Dollar', 'CA$', 2, 1, 0, NULL, 5),
  ('AUD', 'Australian Dollar', 'A$', 2, 1, 0, NULL, 6),
  ('CHF', 'Swiss Franc', 'CHF', 2, 1, 0, NULL, 7),
  ('JPY', 'Japanese Yen', '¥', 0, 1, 0, NULL, 8);
