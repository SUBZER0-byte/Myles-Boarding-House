# How to Run Myle's Boarding House (VS Code Setup)

A complete, step-by-step guide to get the entire system running locally inside **Visual Studio Code** (Windows / macOS / Linux).

---

## 0. What you'll be running

The project has **4 components** — local services must be running and the cloud API must be configured:

| # | Component | Tech | Port | Purpose |
|---|-----------|------|------|---------|
| 1 | Database + PHP API | XAMPP (Apache + MySQL) | 80 / 3306 | REST endpoints + data |
| 2 | Realtime server | PHP CLI (Ratchet) | 8080 / 8081 | Instant push (chat, dashboards) |
| 3 | AI Chatbot | Ollama Cloud API | HTTPS | Landing-page chatbot |
| 4 | Frontend | React + Vite | **5173** | The UI you interact with |

> ✅ Vite is locked to port **5173** (see `vite.config.ts`) so it never collides with the Ratchet WebSocket server on 8080.

---

## 1. Prerequisites

Install these **before** opening VS Code:

- **VS Code** — https://code.visualstudio.com
- **XAMPP** (PHP 8.1+) — https://www.apachefriends.org
- **Composer** — https://getcomposer.org
- **Bun** (or Node.js 18+) — https://bun.sh
- **Git** — https://git-scm.com

### Recommended VS Code extensions
Open VS Code → Extensions (`Ctrl+Shift+X`) and install:

- **PHP Intelephense** (`bmewburn.vscode-intelephense-client`)
- **ES7+ React/Redux snippets** (`dsznajder.es7-react-js-snippets`)
- **Tailwind CSS IntelliSense** (`bradlc.vscode-tailwindcss`)
- **ESLint** (`dbaeumer.vscode-eslint`)
- **MySQL** by Jun Han (`formulahendry.vscode-mysql`) — optional DB browser
- **Thunder Client** (`rangav.vscode-thunder-client`) — optional REST tester

---

## 2. Place the project inside XAMPP `htdocs/`

The PHP backend must be served by Apache, so the code lives under XAMPP:

- Windows: `C:\xampp\htdocs\Myles-Boarding-House\`
- macOS: `/Applications/XAMPP/htdocs/Myles-Boarding-House/`
- Linux: `/opt/lampp/htdocs/Myles-Boarding-House/`

Then open that folder in VS Code:

```bash
code C:\xampp\htdocs\Myles-Boarding-House
```

Confirm the backend is reachable at:
```
http://localhost/Myles-Boarding-House/backend/
```

---

## 3. Database setup (XAMPP / phpMyAdmin)

1. Open **XAMPP Control Panel** → Start **Apache** and **MySQL**.
   - Your screenshot shows Apache on **80/443** and MySQL on **3306** ✅
2. Visit http://localhost/phpmyadmin
3. **New** → create a database named exactly:
   ```
   Boarding-House-Database
   ```
   (Collation: `utf8mb4_unicode_ci`)
4. Select the database → **Import** tab → choose `backend/database.sql` → **Go**.
5. Demo accounts (password for all = **`123456`**):

   | Role   | Email               | Password |
   |--------|---------------------|----------|
   | Admin  | admin@myles.local   | 123456   |
   | Tenant | tenant@myles.local  | 123456   |
   | Tenant | maria@myles.local   | 123456   |

If MySQL runs on a different port (e.g. 3307), edit `backend/Config/db.php` or set `DB_PORT` env var.

---

## 4. Open 2 integrated terminals in VS Code

In VS Code press `` Ctrl+` `` (backtick) to open the terminal panel. Click the **`+`** icon to add a second terminal.

You can rename each tab (right-click → Rename) to keep track: `realtime`, `vite`.

---

## 5. XAMPP (Apache + MySQL)

Already started via the XAMPP Control Panel in Step 3. You can leave its window open in the background; no VS Code terminal needed for it.

---

## 6. Terminal 1 — Realtime WebSocket server (Ratchet)

**First time only** — install PHP dependencies:
```bash
cd backend/Realtime
composer install
```

**Every time** — start the server:
```bash
php server.php
```

Expected output:
```
WebSocket listening on ws://0.0.0.0:8080
Internal publisher TCP listening on 127.0.0.1:8081
```

> If `php` isn't found, add XAMPP's PHP to your PATH (Windows: `C:\xampp\php`) or run the command using the full path: `C:\xampp\php\php.exe server.php`.

---

## 7. Configure Ollama Cloud (AI Chatbot)

Create an API key at https://ollama.com/settings/keys. Sign in as an administrator and enter it in **Admin Panel → Settings → Ollama Cloud Settings**, then save. The key is stored in `system_settings`, masked by default in Admin Settings, and can be revealed there by an administrator. Never put it in the frontend `.env` or source control.

Alternatively, configure `OLLAMA_API_KEY` in the PHP server environment or add this entry inside the returned array in `backend/Config/secrets.php`:
```php
'OLLAMA_API_KEY' => 'your-ollama-api-key',
```
An environment variable takes precedence over the database key. The chatbot uses `gemma4:31b` by default; set `OLLAMA_CLOUD_MODEL` on the server to choose a different cloud model. No local Ollama installation, model download, or `ollama serve` process is needed.

After importing an existing database, apply `backend/migrations/018_chatbot_faqs.sql` and `backend/migrations/019_chatbot_suggested_questions.sql`. Administrators can then add, edit, deactivate, or delete chatbot answers in **Admin Panel → Settings → Public Chatbot FAQs**. FAQ questions selected as suggestions appear in the chatbot's **Suggested questions** list. The chatbot uses live room data for rates and availability, and active FAQs for the corresponding topic. Set the landlady's phone or email in **Admin Panel → Settings → House Contact Info** so unrecognized questions can direct visitors to the right contact.

For guest room holds, apply `backend/migrations/031_booking_room_holds.sql`. This enables the five-minute room hold created when a guest clicks **Book Now**.

For capacity-based and entire-room booking allocations, apply `backend/migrations/032_whole_room_bookings.sql` after migration 031. Existing bookings and tenants default to capacity-based allocation. Booking and hold actions require both migrations; room listings remain available before they are applied.

---

## 8. Terminal 2 — Frontend (React + Vite on port 5173)

**First time only** — install dependencies (run from the project root):
```bash
bun install
```

Create / verify `.env` at the project root:
```env
VITE_API_BASE_URL=http://localhost/Myles-Boarding-House/backend
VITE_WS_URL=ws://localhost:8080
```

**Every time** — start the dev server:
```bash
bun run dev
```

Vite is configured to run on **http://localhost:5173** — click the link in VS Code's terminal (hold `Ctrl` + click) to open it in your browser.

> Prefer npm? `npm install && npm run dev` works too.

---

## 9. Quick start checklist (every time you boot)

1. ✅ XAMPP Control Panel → Start **Apache** + **MySQL**
2. ✅ Configure the Ollama Cloud API key in `backend/Config/secrets.php`
3. ✅ VS Code Terminal 1: `cd backend/Realtime && php server.php`
4. ✅ VS Code Terminal 2: `bun run dev`
5. ✅ Open http://localhost:5173 and sign in:
   - `admin@myles.local` / `123456`
   - `tenant@myles.local` / `123456`
   - `maria@myles.local` / `123456`

---

## 10. Verify everything works

| Test | Expected result |
|------|-----------------|
| Visit http://localhost/Myles-Boarding-House/backend/Landing-Page/rooms.php | JSON list of rooms |
| Bottom-right chatbot on landing page | Replies with room/price info |
| Admin marks payment paid in one browser | Tenant page updates **instantly** in another |
| **Find Us** section on the landing page | Map renders with the boarding house pin |

---

## 11. Troubleshooting

**"Failed to fetch" / API errors**
→ Apache not running, or `VITE_API_BASE_URL` in `.env` is wrong.

**Chatbot says "AI unavailable"**
→ Check that `OLLAMA_API_KEY` is configured on the PHP server and that the selected cloud model is available to your Ollama account.

**Dashboards don't update live**
→ Ratchet server isn't running. Restart `php server.php` in Terminal 1.

**Port 5173 already in use**
→ Another Vite/Node app is running. Stop it, or temporarily run `bun run dev -- --port 5174`.

**Port 8080 already in use** (Ratchet won't start)
→ Stop whatever else is using 8080, or edit `backend/Realtime/server.php` and the `VITE_WS_URL` in `.env` to a new port.

**`composer install` fails / `php: command not found`**
→ Add XAMPP's PHP to PATH (Windows: `C:\xampp\php`) and restart VS Code.

**Database connection refused**
→ MySQL not started in XAMPP, or port is not 3306. Set `DB_PORT` env var or edit `backend/Config/db.php`.

**Sign in always says "Invalid username or password"**
→ Re-import `backend/database.sql` so the demo accounts get the new `123456` bcrypt hash.

---

## 12. How realtime works (under the hood)

- Every PHP mutation (`INSERT`/`UPDATE`/`DELETE`/`mark_paid`/`send`) calls `rt_publish('/Admin/payments.php')` after writing to MySQL.
- The Ratchet server broadcasts that topic to every subscribed browser.
- The frontend `usePolling` hook subscribes to the URL it fetches, so dashboards refetch **instantly** — no 5-second wait.
- Chat (`/chat`) pushes the message payload directly for Messenger-style delivery.
- If the WS server is offline, the app gracefully falls back to 5s polling.

### Adding realtime to a new endpoint
1. `include '../Config/realtime.php';` at the top.
2. After your write, call `rt_publish('/Area/file.php');`
3. Done — every connected client refetches immediately.

---

You're all set! 🎉 If anything misbehaves, re-run the checklist in **Section 9** — 9 times out of 10 one of the four services simply isn't running.
