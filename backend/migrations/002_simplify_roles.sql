ALTER TABLE users DROP CONSTRAINT users_role_check;
UPDATE users SET role='admin' WHERE role IN ('superadmin','finance_admin');
UPDATE users SET role='staff' WHERE role IN ('cashier','hardware_tech','software_dev');
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','staff'));
UPDATE users SET is_active=false WHERE email LIKE '%@myekalliptus.test';
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@myekalliptus.test');
