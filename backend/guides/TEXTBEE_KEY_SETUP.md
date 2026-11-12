# TextBee Integration Summary for Myle's Boarding House

## 🎯 QUICK ANSWER TO YOUR QUESTION

**Type of Key to Input:** `REST API Key` (String format)

**Header Used:** `x-api-key`

**Example:**
```
Key Name: textbee_api_key
Key Type: REST API Key (unique string)
Format: textbee_live_1a2b3c4d5e6f7g8h9i0j (example format)
Location: Admin Panel → Settings → TextBee Configuration
```

---

## 📊 WHAT TEXTBEE REQUIRES (from documentation review)

### From textbee.dev (How It Works)
1. ✅ Download Android app (7.0+)
2. ✅ Register account on textbee.dev
3. ✅ Generate API Key in Dashboard
4. ✅ Link device to API key (scan QR or paste manually)
5. ✅ Enable SMS gateway in app
6. ✅ Use API key in application headers

### From api.textbee.dev (API Documentation)
- **Authentication Method:** Header-based `x-api-key`
- **Endpoint:** `https://api.textbee.dev/api/v1/gateway/send-sms`
- **HTTP Method:** POST
- **Response Status Codes:**
  - 200 = Success
  - 400 = Bad Request
  - 401 = Unauthorized (invalid/missing key)
  - 404 = Device not found
  - 429 = Rate limited

### From github.com/textbee/textbee (Source Code)
- **Language:** TypeScript/Node.js backend, Kotlin Android
- **Architecture:** REST API + WebSocket
- **Features:** Multi-device, webhooks, bulk SMS, MCP integration
- **Security:** API key authentication (no OAuth)
- **Best for:** 500-50,000 messages/month

---

## ❌ ERRORS YOU MIGHT SEE (with Fixes)

### When Registering Account → OTP SMS Fails

**Error Message:** "Unable to send the OTP SMS. Please try again later."

**Root Causes (in order of likelihood):**

1. **API Key Not Configured (Status: 401)**
   - Symptom: `error: 'TextBee API key is not configured'`
   - Fix: Copy API key to Admin → Settings → `textbee_api_key`

2. **Device Not Registered (Status: 404)**
   - Symptom: `No device with that id on your account`
   - Fix: 
     - Download TextBee app
     - Scan QR code from Dashboard
     - Wait for device to appear as "online"

3. **SMS OTP Not Enabled (Status: 0)**
   - Symptom: SMS function silently disabled
   - Fix: Admin → Settings → Check `registration_sms_otp_enabled`

4. **Invalid/Revoked API Key (Status: 401)**
   - Symptom: `Invalid, invalid, or revoked API key`
   - Fix: Generate new key from Dashboard

5. **Phone Number Format Invalid (Status: 400)**
   - Symptom: `Bad Request - Invalid device ID or request format`
   - Fix: Ensure phone is `09171234567` or `+639171234567` format

6. **Network/Firewall Issue (Status: 0)**
   - Symptom: `curl error: couldn't resolve host`
   - Fix: Check internet connection and firewall rules

7. **Rate Limited (Status: 429)**
   - Symptom: `Too many requests`
   - Fix: 
     - Free plan: 50 SMS/day limit
     - Upgrade to Pro: Unlimited daily

---

## 🔧 FIXES ALREADY IMPLEMENTED

I've added 3 tools to help you debug:

### 1. SMS Error Console (NEW)
**URL:** `http://localhost/July14-Myle's Boarding House/backend/Notifications/test_sms_console.php`

**Shows:**
- HTTP status codes (200, 400, 401, 404, 429, 500, etc.)
- Error details with explanations
- Real-time status text
- API responses
- Curl errors
- Recent SMS log entries

**Use:** Test SMS before and after fixing configuration

### 2. TextBee Diagnostic Tool (NEW)
**URL:** `http://localhost/July14-Myle's Boarding House/backend/Config/textbee_diagnostic.php`

**Checks:**
- ✓ API key configured
- ✓ API base URL correct
- ✓ Device ID set
- ✓ SMS enabled
- ✓ OTP enabled
- ✓ Network connectivity to TextBee
- ✓ SMS log file accessible

**Use:** Run this first to see what's missing

### 3. Setup Guide Document
**File:** `TEXTBEE_SETUP_GUIDE.md` (in this folder)

**Contains:**
- Complete setup steps
- Error reference table
- Security best practices
- Device management guide
- Support contacts

---

## 📝 CONFIGURATION NEEDED IN ADMIN PANEL

**Path:** Admin Dashboard → Settings → SMS Configuration

```
Field Name                      Value To Enter
─────────────────────────────────────────────────────────
textbee_enabled                 ☑ Checked (TRUE)
textbee_api_key                 [Your API Key from Dashboard]
textbee_api_base                https://api.textbee.dev
textbee_device_id               [Device UUID from app] (optional)
sms_default_country_code        +63
registration_sms_otp_enabled    ☑ Checked (TRUE)
```

---

## 🚀 STEP-BY-STEP SETUP (FASTEST PATH)

### 1. Get Android Phone Ready
```
- Device: Any Android 7.0+ phone
- Download: https://textbee.dev/download
- Install: Open APK on phone
- Permissions: Grant SMS permissions when asked
```

### 2. Create TextBee Account & API Key
```
1. Go to: https://app.textbee.dev/register
2. Sign up with email
3. Login to: https://app.textbee.dev/dashboard
4. Click: API Keys → Generate New Key
5. Copy: The entire API key string
```

### 3. Register Device in App
```
Option A - QR Code (Recommended):
  1. In Dashboard, find API key card
  2. Click "Show QR Code"
  3. Open TextBee app on phone
  4. Tap Scan QR
  5. Scan the code
  
Option B - Manual:
  1. Copy API key
  2. Open TextBee app
  3. Paste API key
  4. Device auto-registers
```

### 4. Verify Device Connected
```
1. Dashboard → Devices
2. Should see your phone listed
3. Status should be: "Online" or with recent heartbeat
```

### 5. Configure Boarding House Admin Panel
```
1. Go to: Admin → Settings
2. Find: SMS Configuration section
3. Input these fields:
   - textbee_enabled: Check the checkbox
   - textbee_api_key: Paste the API key
   - textbee_api_base: https://api.textbee.dev
   - textbee_device_id: (Optional, can leave blank)
   - registration_sms_otp_enabled: Check the checkbox
4. Click: Save Settings
```

### 6. Test the Connection
```
1. Go to Diagnostic:
   http://localhost/July14-Myle's Boarding House/backend/Config/textbee_diagnostic.php

2. Verify all items show ✓ (green)

3. Test SMS:
   http://localhost/July14-Myle's Boarding House/backend/Notifications/test_sms_console.php
   - Enter test phone number
   - Click "Send Test SMS"
   - Should see Status: 200
```

### 7. Test OTP Registration
```
1. Open frontend registration page
2. Enter email and phone
3. Click "Send OTP"
4. Check phone for SMS
5. Enter code to complete registration
```

---

## 🔑 API KEY SPECIFICATIONS

### Format
```
Type: String (alphanumeric with underscores)
Length: ~50-100 characters
Prefix: textbee_live_ (for production)
Prefix: textbee_test_ (for testing)
Example: textbee_live_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t
```

### Where to Use
```
Header Name: x-api-key
HTTP Method: POST
Example curl:
  curl -X POST https://api.textbee.dev/api/v1/gateway/send-sms \
    -H "x-api-key: YOUR_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"recipients": ["+639171234567"], "message": "Hello"}'
```

### Security
- ✅ Never commit to Git
- ✅ Store only in database (system_settings table)
- ✅ Don't send to browser/frontend
- ✅ Rotate monthly
- ✅ Revoke immediately if compromised

---

## 📊 PRICING & LIMITS

| Feature | Free | Pro | Scale |
|---------|------|-----|-------|
| Cost/month | $0 | $8.33/mo | $24.99/mo |
| Devices | 1 | 5 | 15 |
| Daily limit | 50 SMS/day | Unlimited | Unlimited |
| Monthly limit | 300 SMS | 5,000 SMS | 25,000 SMS |

**For boarding house OTP:** Free plan should be sufficient if <50 registrations/day

---

## ✅ VERIFICATION CHECKLIST

After setup, verify each item:

- [ ] Android phone has TextBee app installed
- [ ] App shows "Ready" or "Connected" status  
- [ ] Dashboard shows device as "Online"
- [ ] API key is in Admin → Settings
- [ ] `textbee_enabled` checkbox is checked
- [ ] `registration_sms_otp_enabled` checkbox is checked
- [ ] Diagnostic tool shows all ✓ (green)
- [ ] Test SMS shows Status: 200
- [ ] Test OTP registration receives SMS
- [ ] Phone battery charged (app needs to run in background)
- [ ] Phone has SMS permissions granted
- [ ] Internet connection stable

---

## 🐛 DEBUGGING WITH LOG FILES

### SMS Log Location
```
File: backend/Notifications/sms.log
Format: Tab-separated with timestamps
```

### Example Log Entry
```
[2026-08-24T10:30:00+00:00] SMS to=+639171234567 | STATUS=200 | ok=YES | msg='Your OTP code is 123456' | api_response={"messageId":"msg_xxx"} | curl_error= | status_info=OK - Message sent
```

### What Each Status Means
```
200 = ✓ Successfully sent
400 = ✗ Invalid request/device
401 = ✗ Invalid API key
404 = ✗ Device not found
429 = ✗ Rate limited
500 = ✗ TextBee server error
0   = ✗ Network connection failed
```

---

## 💬 SUPPORT RESOURCES

- **Official Docs:** https://textbee.dev/docs
- **API Reference:** https://api.textbee.dev
- **GitHub:** https://github.com/textbee/textbee
- **Discord Community:** https://textbee.dev/discord
- **Email Support:** contact@textbee.dev or support@textbee.dev
- **Status Page:** https://status.textbee.dev/

---

## 🎓 QUICK REFERENCE

**What you're doing:** Using your Android phone as an SMS gateway

**How it works:**
1. Your phone sends SMS through its SIM card
2. Phone is registered with TextBee account
3. TextBee API relays messages to your server
4. Your server sends SMS via API to TextBee
5. SMS goes through phone's SIM to recipient

**Why no per-message fees:** SMS comes from your carrier plan (often unlimited)

**Why it works for OTP:** Low volume, high reliability, real phone number

**When it fails:** Usually API key issues or device not registered

---

**Created:** 2026-08-24  
**TextBee Version:** Latest (v2.8.0+)  
**For:** Myle's Boarding House SMS Integration  
**Status:** Ready to deploy after setup ✓
