# PayMongo configuration

The backend reads these server-side variables. Do not put secret values in the frontend or commit them to source control.

| Variable | Purpose |
| --- | --- |
| `PAYMONGO_SECRET_KEY` | PayMongo API secret key |
| `PAYMONGO_PUBLIC_KEY` | PayMongo public key |
| `PAYMONGO_WEBHOOK_SECRET` | Webhook signature secret |
| `PAYMONGO_API_BASE` | PayMongo API base URL, normally `https://api.paymongo.com/v1` |
| `APP_BASE_URL` | Public base URL of the React app; used to construct payment return URLs |

## XAMPP environment variables

In `C:\xampp\apache\conf\extra\httpd-xampp.conf`, add the following `SetEnv` directives inside the appropriate Apache configuration section, replacing the placeholders with your own values:

```apache
SetEnv PAYMONGO_SECRET_KEY "replace-with-your-secret-key"
SetEnv PAYMONGO_PUBLIC_KEY "replace-with-your-public-key"
SetEnv PAYMONGO_WEBHOOK_SECRET "replace-with-your-webhook-secret"
SetEnv PAYMONGO_API_BASE "https://api.paymongo.com/v1"
SetEnv APP_BASE_URL "https://your-public-app.example"
```

Restart Apache after changing this file. For local testing with `sk_test_` / `pk_test_` keys, set `APP_BASE_URL` to the URL serving the frontend routes, for example `http://localhost:5173`. For production, use the public HTTPS frontend URL. Live secret keys are rejected unless `APP_BASE_URL` uses HTTPS.

## Private PHP secrets file

Alternatively, copy `backend/Config/secrets.example.php` to `backend/Config/secrets.php` and replace the placeholder values. This file is ignored by Git. Environment variables take precedence over values in the PHP file.

Use your own credentials from the PayMongo dashboard; do not commit or share them. After setting the values, restart Apache and try a booking checkout. If PayMongo reports that the secret key is not configured, Apache has not received `PAYMONGO_SECRET_KEY` and `backend/Config/secrets.php` is missing, unreadable, or still contains placeholders.

If an existing database contains older PayMongo settings, remove those plaintext values once:

```sql
DELETE FROM system_settings
WHERE setting_key IN ('paymongo_api_base', 'paymongo_public_key', 'paymongo_secret_key');
```
