-- The PIN sign-in flow was removed: students identify themselves with a QR card, or
-- tap their name on the kiosk. Existing PIN credentials are dead weight and are
-- personal data we no longer have a reason to hold, so they go.
--
-- The 'pin' value stays in the credential_kind enum. Postgres cannot drop an enum
-- value without recreating the type and rewriting every dependent column, which is a
-- disproportionate risk for an unused label. Nothing issues or reads it.
DELETE FROM credential WHERE kind = 'pin';
