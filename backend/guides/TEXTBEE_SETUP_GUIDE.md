# TextBee SMS Integration Setup & Troubleshooting Guide

## 🔑 KEY TYPE REQUIRED

**Type: REST API Key (String)**

### Format:
```
API Key: Unique string identifier generated from TextBee Dashboard
Header: x-api-key: <YOUR_API_KEY>
```

**Example Header:**
```
x-api-key: textbee_live_1a2b3c4d5e6f7g8h9i0j...
```

---

## 📋 COMPLETE SETUP CHECKLIST

### Step 1: Android Device Setup
- [ ] Install TextBee app on Android phone (Android 7.0+)
  - Download: https://textbee.dev/download
- [ ] Grant SMS permissions in the app
- [ ] Enable the gateway in the app

### Step 2: Create API Key in TextBee Dashboard
- [ ] Go to: https://app.textbee.dev/dashboard
- [ ] Sign up/Login with email
- [ ] Navigate to **API Keys** section
- [ ] Click **Generate API Key**
- [ ] Copy the generated key (looks like: `textbee_live_xxxxx...`)
- [ ] Note: You can create unlimited API keys

### Step 3: Link Device to API Key
**Option A: Scan QR Code**
- [ ] In Dashboard, show QR code
- [ ] Open TextBee app on Android phone
- [ ] Scan the QR code
- [ ] Device registers automatically

**Option B: Manual Entry**
- [ ] Copy the API key from Dashboard
- [ ] In TextBee app, paste API key
- [ ] Device registers automatically

### Step 4: Configure in Myle's Boarding House Admin Panel
Navigate to: **Admin → Settings → SMS Configuration**

Fill in these fields:
```
textbee_enabled: TRUE (checkbox enabled)
textbee_api_key: <YOUR_API_KEY_FROM_STEP_2>
textbee_api_base: https://api.textbee.dev
textbee_device_id: <DEVICE_ID_FROM_APP> (optional but recommended)
sms_default_country_code: +63 (for Philippine numbers)
registration_sms_otp_enabled: TRUE (for OTP registration)
```

### Step 5: Test the Connection
Use the SMS Debug Console:
```
URL: http://localhost/July14-Myle's Boarding House/backend/Notifications/test_sms_console.php
```

---

## 🔴 COMMON ERRORS & FIXES

### Error 401: Unauthorized
**Cause:** Invalid, missing, or revoked API key

**Fixes:**
1. Verify API key is correct (copy-paste from dashboard)
2. Check if API key was revoked in dashboard
3. Ensure `textbee_api_key` setting is not empty
4. Create a new API key if old one expired

**Status Response:**
```json
{
  "status": 401,
  "status_text": "Unauthorized - Invalid or missing API key",
  "error": "Missing, invalid, or revoked API key"
}
```

---

### Error 400: Bad Request
**Cause:** Invalid device ID or request format

**Fixes:**
1. Verify device ID is correct
2. Check phone number format (must be E.164: +639171234567)
3. Ensure message is not empty
4. Device must be registered and enabled in app

**Status Response:**
```json
{
  "status": 400,
  "status_text": "Bad Request - Invalid device ID or request format",
  "error": "Invalid request parameters"
}
```

---

### Error 404: Not Found
**Cause:** Device not registered or linked to account

**Fixes:**
1. Register device in TextBee app first
2. Ensure device QR code was scanned or API key pasted
3. Check device is listed in Dashboard → Devices
4. Verify device is enabled (green status)
5. Re-register device if necessary

**Status Response:**
```json
{
  "status": 404,
  "status_text": "Not Found - Device not registered on account",
  "error": "No device with that id on your account"
}
```

---

### Error 429: Rate Limited
**Cause:** Too many SMS requests in short time

**Fixes:**
1. Reduce send frequency
2. Implement rate limiting in your application
3. Batch SMS sends using bulk endpoint
4. Upgrade to Pro plan for higher limits

**Rate Limits:**
- **Free Plan:** 50 messages/day
- **Pro Plan:** Unlimited daily, 5,000/month
- **Scale Plan:** Unlimited daily, 25,000/month

---

### Error 500: Server Error
**Cause:** TextBee API server issue

**Fixes:**
1. Check TextBee status: https://status.textbee.dev/
2. Wait a few minutes and retry
3. Contact support: contact@textbee.dev

---

### Error 0: Network Connection Failed
**Cause:** Cannot reach api.textbee.dev or timeout

**Fixes:**
1. Check internet connection on XAMPP server
2. Verify firewall allows outbound HTTPS to api.textbee.dev
3. Check DNS resolution: `nslookup api.textbee.dev`
4. Verify curl extension is enabled in PHP
5. Check PHP timeout setting

---

## 📊 EXPECTED RESPONSE FORMATS

### Success Response (200)
```json
{
  "type": "success",
  "message": "SMS sent successfully",
  "status": 200,
  "status_text": "OK - Message sent",
  "data": {
    "messageId": "msg_xxxxx...",
    "recipients": 1,
    "status": "sent"
  }
}
```

### Error Response (401)
```json
{
  "type": "error",
  "message": "Send failed",
  "status": 401,
  "status_text": "Unauthorized - Invalid or missing API key",
  "error_details": {
    "status_code": 401,
    "curl_error": null,
    "api_response": {
      "message": "Missing, invalid, or revoked API key"
    }
  }
}
```

### OTP Success Response
```json
{
  "type": "success",
  "message": "OTP sent to your phone. Enter the code below to continue.",
  "phone": "+639171234567"
}
```

### OTP Error Response
```json
{
  "type": "error",
  "message": "Unable to send the OTP SMS. Please try again later.",
  "status": 401
}
```

---

## 🔍 DEBUGGING & LOGGING

### Check SMS Log
**File Location:** `backend/Notifications/sms.log`

**Log Format:**
```
[2026-08-24T10:30:00+00:00] SMS to=+639171234567 | STATUS=200 | ok=YES | msg='Your OTP code...' | api_response={"messageId":"msg_xxx"} | curl_error= | status_info=OK - Message sent
```

### View Logs via Admin Dashboard
- Go to Admin → Logs → SMS
- Search by phone number or date
- View delivery status and errors

### Live Console Debugging
Use SMS Error Console (provided earlier):
```
URL: http://localhost/July14-Myle's Boarding House/backend/Notifications/test_sms_console.php
```

Features:
- Send test SMS
- Broadcast to multiple numbers
- View real-time status codes (200, 400, 401, 404, etc.)
- View HTTP error details
- Monitor last 50 SMS attempts

---

## 🔐 SECURITY BEST PRACTICES

1. **Never expose API key in frontend code**
   - Keep API key only in `backend/Config/sms.php`
   - Store in database `system_settings` table
   - Do not pass to browser/JavaScript

2. **Rotate API keys regularly**
   - Delete old keys from dashboard
   - Create new keys monthly
   - Revoke compromised keys immediately

3. **Use environment variables (optional)**
   - Store key in .env file for production
   - Example: `TEXTBEE_API_KEY=xxxxx`

4. **Enable HTTPS**
   - All API calls must use HTTPS
   - Already configured: `https://api.textbee.dev`

5. **Webhook security** (if using webhooks)
   - Verify webhook signatures
   - Use secret token for webhook authentication
   - Implement webhook retry logic

---

## 📱 DEVICE MANAGEMENT

### View Registered Devices
1. Go to TextBee Dashboard: https://app.textbee.dev/dashboard
2. Click **Devices**
3. See all registered Android phones
4. View device status (online/offline)
5. Last heartbeat timestamp

### Device ID Format
Device ID is typically a UUID:
```
Example: 550e8400-e29b-41d4-a716-446655440000
```

**Get Device ID:**
1. Open TextBee app on Android
2. Settings → Device ID
3. Copy the ID
4. Paste in `textbee_device_id` setting

### Multiple Devices
- Free Plan: 1 device
- Pro Plan: Up to 5 devices
- Scale Plan: Up to 15 devices

**Specify which device sends SMS:**
```json
{
  "recipients": ["+639171234567"],
  "message": "Hello!",
  "deviceId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

## 📞 SUPPORT & RESOURCES

### Official Documentation
- Website: https://textbee.dev
- API Docs: https://api.textbee.dev
- GitHub: https://github.com/textbee/textbee
- Discord: https://textbee.dev/discord

### Contact
- Email: support@textbee.dev or contact@textbee.dev
- Discord: https://textbee.dev/discord
- System Status: https://status.textbee.dev/

### Common Questions
1. **Can I use iPhone?** No, TextBee requires Android 7.0+
2. **Can I change sender ID?** No, SMS come from your phone number
3. **Do I need to keep phone on?** Yes, phone must stay online with app running
4. **Bulk SMS limit?** Depends on plan (Free: 50/day, Pro: unlimited daily)
5. **Can I receive SMS?** Yes, via API or webhooks

---

## ✅ QUICK VERIFICATION CHECKLIST

After setup, verify:

- [ ] Android phone has TextBee app installed
- [ ] App shows "Connected" or "Ready" status
- [ ] Dashboard shows device as "online"
- [ ] API key copied to admin settings
- [ ] Test SMS sends successfully (status 200)
- [ ] OTP registration works end-to-end
- [ ] SMS log shows successful entries
- [ ] No 401 errors in logs
- [ ] Phone can send/receive SMS normally
- [ ] Internet connection stable on server

---

## 🚀 NEXT STEPS

1. **Download TextBee App** → https://textbee.dev/download
2. **Install on Android** → Grant permissions
3. **Create API Key** → https://app.textbee.dev/dashboard
4. **Configure Admin Panel** → Settings → SMS
5. **Test Connection** → Use SMS Console at `/test_sms_console.php`
6. **Monitor Logs** → Check `sms.log` for issues
7. **Deploy to Production** → Keep phone online and powered

---

**Last Updated:** 2026-08-24  
**TextBee Version:** Latest (v2.8.0)  
**API Base:** https://api.textbee.dev/api/v1
