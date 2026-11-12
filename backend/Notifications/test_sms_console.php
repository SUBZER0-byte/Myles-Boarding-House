<?php
/**
 * SMS Error Console Tester
 * 
 * Access: http://localhost/July14-Myle's Boarding House/backend/Notifications/test_sms_console.php
 * 
 * Shows:
 * - Status codes (200, 400, 401, 404, 429, 500, etc.)
 * - Error details
 * - API responses
 * - Curl errors
 * - Recent SMS logs
 */

include '../Config/db.php';
include __DIR__ . '/sms_helper.php';

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SMS Error Console</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Courier New', monospace;
            background: #1e1e1e;
            color: #d4d4d4;
            padding: 20px;
            line-height: 1.6;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            background: #252526;
            padding: 15px;
            border-left: 4px solid #007acc;
            margin-bottom: 20px;
        }
        .header h1 { color: #4ec9b0; font-size: 24px; }
        .header p { color: #858585; font-size: 12px; margin-top: 5px; }
        
        .panels {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }
        
        .panel {
            background: #252526;
            border: 1px solid #3e3e42;
            border-radius: 4px;
            padding: 15px;
        }
        
        .panel h2 {
            color: #4ec9b0;
            font-size: 14px;
            margin-bottom: 10px;
            text-transform: uppercase;
            border-bottom: 1px solid #3e3e42;
            padding-bottom: 10px;
        }
        
        .form-group {
            margin-bottom: 12px;
        }
        
        label {
            display: block;
            color: #ce9178;
            font-size: 12px;
            margin-bottom: 5px;
        }
        
        input[type="text"],
        textarea {
            width: 100%;
            padding: 8px;
            background: #1e1e1e;
            border: 1px solid #3e3e42;
            color: #d4d4d4;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            border-radius: 3px;
        }
        
        textarea {
            resize: vertical;
            min-height: 80px;
        }
        
        button {
            background: #007acc;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 3px;
            cursor: pointer;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            font-weight: bold;
            transition: background 0.2s;
        }
        
        button:hover {
            background: #005a9e;
        }
        
        button.secondary {
            background: #6a9955;
        }
        
        button.secondary:hover {
            background: #558b2f;
        }
        
        .response-box {
            background: #1e1e1e;
            border: 1px solid #3e3e42;
            border-radius: 3px;
            padding: 10px;
            margin-top: 10px;
            max-height: 300px;
            overflow-y: auto;
            font-size: 11px;
        }
        
        .success {
            color: #6a9955;
        }
        
        .error {
            color: #f48771;
        }
        
        .warning {
            color: #dcdcaa;
        }
        
        .info {
            color: #9cdcfe;
        }
        
        .status-badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: bold;
            margin: 2px;
        }
        
        .status-200 {
            background: #6a9955;
            color: white;
        }
        
        .status-400 {
            background: #cd9731;
            color: white;
        }
        
        .status-401 {
            background: #f48771;
            color: white;
        }
        
        .status-404 {
            background: #f48771;
            color: white;
        }
        
        .status-429 {
            background: #dcdcaa;
            color: #1e1e1e;
        }
        
        .status-500 {
            background: #f48771;
            color: white;
        }
        
        .status-0 {
            background: #858585;
            color: white;
        }
        
        .log-panel {
            grid-column: 1 / -1;
        }
        
        .log-entry {
            padding: 8px;
            margin-bottom: 8px;
            background: #1e1e1e;
            border-left: 3px solid #3e3e42;
            font-size: 11px;
            word-break: break-all;
        }
        
        .log-entry.success {
            border-left-color: #6a9955;
        }
        
        .log-entry.error {
            border-left-color: #f48771;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📱 SMS Error Console</h1>
            <p>TextBee API Debug & Testing Tool • Real-time error logging & status tracking</p>
        </div>
        
        <div class="panels">
            <!-- Test Send Panel -->
            <div class="panel">
                <h2>🧪 Test SMS Send</h2>
                <div class="form-group">
                    <label>Phone Number</label>
                    <input type="text" id="testPhone" placeholder="e.g., 09171234567 or +639171234567" value="09171234567">
                </div>
                <button onclick="testSend()">Send Test SMS</button>
                <div id="testResponse" class="response-box"></div>
            </div>
            
            <!-- Broadcast Panel -->
            <div class="panel">
                <h2>📢 Broadcast SMS</h2>
                <div class="form-group">
                    <label>Phone Numbers (comma-separated)</label>
                    <textarea id="broadcastPhones" placeholder="09171234567, 09271234567, +639371234567"></textarea>
                </div>
                <div class="form-group">
                    <label>Message</label>
                    <textarea id="broadcastMessage" placeholder="Enter your message here">Test broadcast message</textarea>
                </div>
                <button onclick="testBroadcast()">Send Broadcast</button>
                <div id="broadcastResponse" class="response-box"></div>
            </div>
            
            <!-- Single Send Panel -->
            <div class="panel">
                <h2>✉️ Send Single SMS</h2>
                <div class="form-group">
                    <label>Recipient Phone</label>
                    <input type="text" id="singlePhone" placeholder="e.g., 09171234567">
                </div>
                <div class="form-group">
                    <label>Message</label>
                    <textarea id="singleMessage" placeholder="Enter your message here">Hello from Myle's Boarding House!</textarea>
                </div>
                <button onclick="sendSingle()">Send SMS</button>
                <div id="singleResponse" class="response-box"></div>
            </div>
            
            <!-- Status Codes Reference -->
            <div class="panel">
                <h2>📋 HTTP Status Codes</h2>
                <div style="font-size: 11px; line-height: 1.8;">
                    <div><span class="status-badge status-200">200</span> OK - Message sent successfully</div>
                    <div><span class="status-badge status-400">400</span> Bad Request - Invalid device ID or format</div>
                    <div><span class="status-badge status-401">401</span> Unauthorized - Invalid/missing API key</div>
                    <div><span class="status-badge status-404">404</span> Not Found - Device not on account</div>
                    <div><span class="status-badge status-429">429</span> Rate Limited - Too many requests</div>
                    <div><span class="status-badge status-500">500</span> Server Error - TextBee API error</div>
                    <div><span class="status-badge status-0">0</span> No Connection - Network error</div>
                </div>
            </div>
            
            <!-- Recent Logs -->
            <div class="panel log-panel">
                <h2>📜 Recent SMS Logs</h2>
                <button class="secondary" onclick="loadLogs()">Refresh Logs</button>
                <button class="secondary" onclick="clearLogs()">Clear Logs</button>
                <div id="logsContent" class="response-box" style="max-height: 400px;"></div>
            </div>
        </div>
    </div>
    
    <script>
        function getStatusClass(status) {
            if (status >= 200 && status < 300) return 'success';
            if (status === 0) return 'error';
            return 'error';
        }
        
        function formatResponse(data) {
            return '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
        }
        
        async function testSend() {
            const phone = document.getElementById('testPhone').value.trim();
            if (!phone) {
                showError('testResponse', 'Phone number is required');
                return;
            }
            
            const url = `sms.php?action=test&to=${encodeURIComponent(phone)}`;
            
            try {
                const response = await fetch(url);
                const data = await response.json();
                showResponse('testResponse', data);
            } catch (e) {
                showError('testResponse', `Network error: ${e.message}`);
            }
        }
        
        async function sendSingle() {
            const phone = document.getElementById('singlePhone').value.trim();
            const message = document.getElementById('singleMessage').value.trim();
            
            if (!phone || !message) {
                showError('singleResponse', 'Phone and message are required');
                return;
            }
            
            try {
                const response = await fetch('sms.php?action=send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recipient: phone, message })
                });
                const data = await response.json();
                showResponse('singleResponse', data);
            } catch (e) {
                showError('singleResponse', `Network error: ${e.message}`);
            }
        }
        
        async function testBroadcast() {
            const phonesRaw = document.getElementById('broadcastPhones').value.trim();
            const message = document.getElementById('broadcastMessage').value.trim();
            
            if (!phonesRaw || !message) {
                showError('broadcastResponse', 'Phones and message are required');
                return;
            }
            
            const recipients = phonesRaw.split(',').map(p => p.trim()).filter(p => p);
            if (recipients.length === 0) {
                showError('broadcastResponse', 'At least one valid phone number required');
                return;
            }
            
            try {
                const response = await fetch('sms.php?action=broadcast', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recipients, message })
                });
                const data = await response.json();
                showResponse('broadcastResponse', data);
            } catch (e) {
                showError('broadcastResponse', `Network error: ${e.message}`);
            }
        }
        
        function showResponse(elementId, data) {
            const el = document.getElementById(elementId);
            const statusCode = data.status || 0;
            const statusClass = statusCode >= 200 && statusCode < 300 ? 'success' : 'error';
            
            let html = `<div class="${statusClass}">`;
            html += `<strong>Status: <span class="status-badge status-${statusCode}">${statusCode}</span></strong><br>`;
            html += `<strong>Type:</strong> ${data.type}<br>`;
            html += `<strong>Message:</strong> ${data.message}<br>`;
            if (data.status_text) html += `<strong>Status Text:</strong> ${data.status_text}<br>`;
            
            if (data.error_details) {
                html += `<br><strong>Error Details:</strong><br>`;
                html += `  • Curl Error: ${data.error_details.curl_error || 'None'}<br>`;
                html += `  • API Response: ${JSON.stringify(data.error_details.api_response)}<br>`;
            }
            
            if (data.summary) {
                html += `<br><strong>Summary:</strong><br>`;
                html += `  • Sent: ${data.summary.sent}<br>`;
                html += `  • Failed: ${data.summary.failed}<br>`;
                html += `  • Total: ${data.summary.total}<br>`;
            }
            
            if (data.data && Array.isArray(data.data) && data.data.length > 0) {
                html += `<br><strong>Details:</strong><br>`;
                data.data.forEach((item, i) => {
                    const itemStatus = item.status >= 200 && item.status < 300 ? 'success' : 'error';
                    html += `<div style="margin-left: 10px; color: ${itemStatus === 'success' ? '#6a9955' : '#f48771'}">`;
                    html += `  [${i+1}] To: ${item.to} | Status: ${item.status} (${item.status_text || item.ok ? 'OK' : 'FAILED'})`;
                    if (item.error) html += ` | Error: ${item.error}`;
                    html += `</div>`;
                });
            }
            
            html += `</div>`;
            el.innerHTML = html;
        }
        
        function showError(elementId, message) {
            const el = document.getElementById(elementId);
            el.innerHTML = `<div class="error"><strong>❌ Error:</strong><br>${message}</div>`;
        }
        
        async function loadLogs() {
            const logsFile = 'sms.log';
            try {
                const response = await fetch(logsFile);
                const text = await response.text();
                const lines = text.split('\n').reverse().filter(l => l.trim());
                
                let html = '';
                lines.slice(0, 50).forEach(line => {
                    const isSuccess = line.includes('ok=yes') || line.includes('ok=YES');
                    const className = isSuccess ? 'success' : 'error';
                    html += `<div class="log-entry ${className}">${escapeHtml(line)}</div>`;
                });
                
                document.getElementById('logsContent').innerHTML = html;
            } catch (e) {
                document.getElementById('logsContent').innerHTML = `<div class="error">Could not load logs: ${e.message}</div>`;
            }
        }
        
        function clearLogs() {
            if (confirm('Are you sure you want to clear all SMS logs?')) {
                fetch('test_sms_console.php?action=clear_logs', { method: 'POST' })
                    .then(() => { loadLogs(); })
                    .catch(e => alert('Error: ' + e.message));
            }
        }
        
        function escapeHtml(text) {
            const map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            };
            return text.replace(/[&<>"']/g, m => map[m]);
        }
        
        // Load logs on page load
        window.addEventListener('load', loadLogs);
    </script>
</body>
</html>

<?php
// Handle clear logs action
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_GET['action'] ?? '') === 'clear_logs') {
    $logFile = __DIR__ . '/sms.log';
    if (file_exists($logFile)) {
        file_put_contents($logFile, '');
        echo json_encode(['success' => true]);
    }
}
?>
