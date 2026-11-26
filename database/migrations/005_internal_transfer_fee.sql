-- Charge a flat fee on internal (Meridian-to-Meridian) transfers, which were free.
-- Deposit and withdrawal fees use the existing transaction_fees rules; adjust amounts in the Admin Fees page.
UPDATE transaction_fees SET flat_fee = 1.0000 WHERE fee_code = 'INT_TRF_USD';
