<?php
/**
 * TextBee Configuration Diagnostic Tool
 * 
 * Access: http://localhost/July14-Myle's Boarding House/backend/Config/textbee_diagnostic.php
 * 
 * Checks:
 * - API key configured
 * - API base URL valid
 * - Device ID registered
 * - SMS OTP enabled
 * - Network connectivity to TextBee API
 * - Database settings readable
 */

include 'db.php';
include '../Notifications/sms_helper.php';

header('Content-Type: text/html; charset=utf-8');

// Collect diagnostic data
$config = include 'sms.php';
$diagnostics = [];

// Check 1: API Key
$diagnostics['api_key'] = [
    'name' => '🔑 API Key Configuration',
    'configured' => !empty($config['api_key']),
    'value' => $config['api_key'] ? '✓ Set (' . substr($config['api_key'], 0, 10) . '...)' : '✗ Missing',
    'required' => true,
    'fix' => 'Go to https://app.textbee.dev/dashboard → API Keys → Generate API Key → Copy to Admin Settings'
];

// Check 2: API Base URL
$diagnostics['api_base'] = [
    'name' => '🌐 API Base URL',
    'configured' => !empty($config['api_base']),
    'value' => $config['api_base'] ?: '✗ Missing (default: https://api.textbee.dev)',
    'required' => true,
    'fix' => 'Should be: https://api.textbee.dev'
];

// Check 3: SMS Enabled
$diagnostics['enabled'] = [
    'name' => '⚡ SMS Service Enabled',
    'configured' => !empty($config['enabled']),
    'value' => $config['enabled'] ? '✓ Enabled' : '✗ Disabled',
    'required' => true,
    'fix' => 'Go to Admin → Settings → Check "textbee_enabled"'
];

// Check 4: Device ID
$diagnostics['device_id'] = [
    'name' => '📱 Device ID',
    'configured' => !empty($config['device_id']),
    'value' => $config['device_id'] ? '✓ Set (' . substr($config['device_id'], 0, 8) . '...)' : '⚠ Not set (optional)',
    'required' => false,
    'fix' => 'Optional but recommended. Get from TextBee app → Settings → Device ID'
];

// Check 5: Country Code
$diagnostics['country_code'] = [
    'name' => '🌍 Default Country Code',
    'configured' => !empty($config['default_country_code']),
    'value' => $config['default_country_code'] ?: '+63 (Philippines)',
    'required' => false,
    'fix' => 'For Philippines: +63'
];

// Check 6: OTP Enabled
$otp_enabled = false;
if (isset($connect) && $connect) {
    $settingStmt = $connect->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'registration_sms_otp_enabled' LIMIT 1");
    if ($settingStmt) {
        $settingStmt->bind_result($value);
        if ($settingStmt->execute() && $settingStmt->fetch()) {
            $otp_enabled = filter_var($value, FILTER_VALIDATE_BOOLEAN);
        }
        $settingStmt->close();
    }
}

$diagnostics['otp_enabled'] = [
    'name' => '🔐 OTP Registration Enabled',
    'configured' => $otp_enabled,
    'value' => $otp_enabled ? '✓ Enabled' : '✗ Disabled',
    'required' => false,
    'fix' => 'Go to Admin → Settings → Check "registration_sms_otp_enabled"'
];

// Check 7: Network Connectivity
$network_ok = false;
$network_message = '🔌 Checking...';
$ch = curl_init('https://api.textbee.dev/api/v1/auth/who-am-i');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 5,
    CURLOPT_SSL_VERIFYPEER => true,
]);
$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curl_error = curl_error($ch);
curl_close($ch);

if ($curl_error) {
    $network_message = '✗ Connection Failed: ' . $curl_error;
} elseif ($http_code === 401) {
    $network_message = '✓ TextBee API Reachable (awaiting auth)';
    $network_ok = true;
} elseif ($http_code >= 200 && $http_code < 300) {
    $network_message = '✓ TextBee API OK';
    $network_ok = true;
} else {
    $network_message = '⚠ Unexpected response: ' . $http_code;
}

$diagnostics['network'] = [
    'name' => '🌐 Network Connectivity to TextBee API',
    'configured' => $network_ok,
    'value' => $network_message,
    'required' => true,
    'fix' => 'Check firewall, DNS, or internet connection'
];

// Check 8: SMS Log File
$log_file = '../Notifications/sms.log';
$log_exists = file_exists($log_file);
$log_readable = $log_exists && is_readable($log_file);
$log_size = $log_readable ? filesize($log_file) : 0;

$diagnostics['log_file'] = [
    'name' => '📄 SMS Log File',
    'configured' => $log_readable,
    'value' => $log_readable ? '✓ Exists (' . number_format($log_size) . ' bytes)' : '⚠ Not readable',
    'required' => false,
    'fix' => 'File should be at: backend/Notifications/sms.log'
];

// Calculate overall health
$required_ok = true;
foreach ($diagnostics as $diag) {
    if ($diag['required'] && !$diag['configured']) {
        $required_ok = false;
        break;
    }
}

$health_color = $required_ok ? '#6a9955' : '#f48771';
$health_status = $required_ok ? '✓ Ready' : '✗ Configuration Issues';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TextBee Configuration Diagnostic</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1e1e1e 0%, #252526 100%);
            color: #d4d4d4;
            padding: 20px;
            line-height: 1.6;
        }
        .container {
            max-width: 1000px;
            margin: 0 auto;
        }
        .header {
            background: linear-gradient(135deg, #252526 0%, #2d2d30 100%);
            border-left: 5px solid #007acc;
            padding: 25px;
            border-radius: 8px;
            margin-bottom: 25px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        .header h1 {
            color: #4ec9b0;
            font-size: 28px;
            margin-bottom: 8px;
        }
        .header p {
            color: #858585;
            font-size: 13px;
        }
        .health-status {
            background: <?php echo $health_color; ?>;
            color: white;
            padding: 12px 16px;
            border-radius: 4px;
            font-weight: bold;
            display: inline-block;
            margin-top: 12px;
            font-size: 14px;
        }
        .diagnostic-items {
            display: grid;
            grid-template-columns: 1fr;
            gap: 12px;
        }
        .diagnostic-item {
            background: #252526;
            border-left: 4px solid #3e3e42;
            padding: 16px;
            border-radius: 4px;
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 16px;
            align-items: start;
            transition: all 0.2s;
        }
        .diagnostic-item:hover {
            background: #2d2d30;
            border-left-color: #007acc;
        }
        .diagnostic-item.success {
            border-left-color: #6a9955;
        }
        .diagnostic-item.warning {
            border-left-color: #dcdcaa;
        }
        .diagnostic-item.error {
            border-left-color: #f48771;
        }
        .item-name {
            font-weight: bold;
            color: #ce9178;
            font-size: 13px;
        }
        .item-value {
            color: #9cdcfe;
            font-size: 13px;
            font-family: 'Courier New', monospace;
            word-break: break-all;
        }
        .item-fix {
            color: #858585;
            font-size: 12px;
            background: #1e1e1e;
            padding: 8px;
            border-radius: 3px;
            border: 1px solid #3e3e42;
        }
        .item-fix strong {
            color: #ce9178;
        }
        .required-badge {
            background: #f48771;
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: bold;
            margin-left: 8px;
        }
        .optional-badge {
            background: #6a9955;
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: bold;
            margin-left: 8px;
        }
        .section {
            margin-top: 30px;
        }
        .section-title {
            color: #4ec9b0;
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 12px;
            border-bottom: 2px solid #007acc;
            padding-bottom: 8px;
        }
        .actions {
            background: #252526;
            padding: 16px;
            border-radius: 4px;
            margin-top: 25px;
            border: 1px solid #3e3e42;
        }
        .action-button {
            background: #007acc;
            color: white;
            border: none;
            padding: 10px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            font-weight: bold;
            margin-right: 8px;
            transition: background 0.2s;
        }
        .action-button:hover {
            background: #005a9e;
        }
        .action-button.secondary {
            background: #6a9955;
        }
        .action-button.secondary:hover {
            background: #558b2f;
        }
        .next-steps {
            background: linear-gradient(135deg, #1e1e1e 0%, #252526 100%);
            padding: 16px;
            border-radius: 4px;
            margin-top: 25px;
            border-left: 4px solid #dcdcaa;
        }
        .next-steps h3 {
            color: #dcdcaa;
            margin-bottom: 8px;
            font-size: 14px;
        }
        .next-steps ol {
            margin-left: 20px;
            color: #9cdcfe;
            font-size: 12px;
        }
        .next-steps li {
            margin-bottom: 6px;
        }
        code {
            background: #1e1e1e;
            padding: 2px 4px;
            border-radius: 3px;
            color: #ce9178;
        }
        a {
            color: #4ec9b0;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 TextBee Configuration Diagnostic</h1>
            <p>Complete health check for SMS integration • Last updated: <?php echo date('Y-m-d H:i:s'); ?></p>
            <div class="health-status"><?php echo $health_status; ?></div>
        </div>
        
        <!-- Configuration Status -->
        <div class="section">
            <div class="section-title">📋 Configuration Status</div>
            <div class="diagnostic-items">
                <?php foreach ($diagnostics as $key => $diag): ?>
                    <?php 
                        $class = $diag['configured'] ? 'success' : ($diag['required'] ? 'error' : 'warning');
                    ?>
                    <div class="diagnostic-item <?php echo $class; ?>">
                        <div>
                            <div class="item-name">
                                <?php echo $diag['name']; ?>
                                <?php if ($diag['required']): ?>
                                    <span class="required-badge">REQUIRED</span>
                                <?php else: ?>
                                    <span class="optional-badge">OPTIONAL</span>
                                <?php endif; ?>
                            </div>
                        </div>
                        <div class="item-value">
                            <?php echo $diag['value']; ?>
                        </div>
                        <div class="item-fix">
                            <strong>Fix:</strong> <?php echo $diag['fix']; ?>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>
        </div>
        
        <!-- Quick Actions -->
        <div class="section">
            <div class="section-title">⚡ Quick Actions</div>
            <div class="actions">
                <a href="https://app.textbee.dev/dashboard" target="_blank">
                    <button class="action-button">📱 Open TextBee Dashboard</button>
                </a>
                <a href="../Admin/settings.php" target="_blank">
                    <button class="action-button secondary">⚙️ Go to Admin Settings</button>
                </a>
                <a href="../Notifications/test_sms_console.php" target="_blank">
                    <button class="action-button secondary">🧪 Open SMS Console</button>
                </a>
                <button class="action-button" onclick="location.reload()">🔄 Refresh Diagnostic</button>
            </div>
        </div>
        
        <!-- Next Steps -->
        <div class="next-steps">
            <h3>📝 Next Steps to Get SMS Working:</h3>
            <ol>
                <li><strong>Download App:</strong> Install TextBee from <a href="https://textbee.dev/download" target="_blank">textbee.dev/download</a> on Android phone</li>
                <li><strong>Generate API Key:</strong> Go to <a href="https://app.textbee.dev/dashboard" target="_blank">Dashboard</a> → API Keys → Create Key</li>
                <li><strong>Register Device:</strong> Scan QR code in TextBee app OR paste API key manually</li>
                <li><strong>Configure Settings:</strong> Admin → Settings → Fill TextBee API Key</li>
                <li><strong>Test Connection:</strong> Use <a href="../Notifications/test_sms_console.php" target="_blank">SMS Console</a> to send test SMS</li>
                <li><strong>Monitor Logs:</strong> Check <code>backend/Notifications/sms.log</code> for delivery status</li>
                <li><strong>Verify OTP:</strong> Test registration flow to ensure OTP SMS sends successfully</li>
            </ol>
        </div>
        
        <!-- Database Check -->
        <div class="section">
            <div class="section-title">💾 Database Settings</div>
            <div class="diagnostic-item success">
                <div>
                    <div class="item-name">Database Connection</div>
                </div>
                <div class="item-value">
                    <?php echo (isset($connect) && $connect) ? '✓ Connected' : '✗ Failed'; ?>
                </div>
                <div class="item-fix">
                    <strong>Status:</strong> Database is <?php echo (isset($connect) && $connect) ? 'accessible' : 'not accessible'; ?>
                </div>
            </div>
        </div>
        
        <!-- Troubleshooting -->
        <div class="section">
            <div class="section-title">🛠️ Troubleshooting Guide</div>
            <table style="width: 100%; border-collapse: collapse;">
                <tr style="border-bottom: 1px solid #3e3e42;">
                    <td style="padding: 12px; color: #f48771; font-weight: bold;">Error 401</td>
                    <td style="padding: 12px; color: #9cdcfe;">Invalid or missing API key</td>
                    <td style="padding: 12px; color: #858585;"><a href="https://app.textbee.dev/dashboard" target="_blank">Generate new key</a> and update Admin Settings</td>
                </tr>
                <tr style="border-bottom: 1px solid #3e3e42;">
                    <td style="padding: 12px; color: #f48771; font-weight: bold;">Error 404</td>
                    <td style="padding: 12px; color: #9cdcfe;">Device not registered</td>
                    <td style="padding: 12px; color: #858585;">Scan QR code in TextBee app or paste API key to register device</td>
                </tr>
                <tr style="border-bottom: 1px solid #3e3e42;">
                    <td style="padding: 12px; color: #f48771; font-weight: bold;">Error 400</td>
                    <td style="padding: 12px; color: #9cdcfe;">Bad request/invalid format</td>
                    <td style="padding: 12px; color: #858585;">Check phone number format (+639171234567) and message not empty</td>
                </tr>
                <tr style="border-bottom: 1px solid #3e3e42;">
                    <td style="padding: 12px; color: #f48771; font-weight: bold;">Error 0</td>
                    <td style="padding: 12px; color: #9cdcfe;">Network connection failed</td>
                    <td style="padding: 12px; color: #858585;">Check internet connection, firewall, DNS resolution</td>
                </tr>
                <tr>
                    <td style="padding: 12px; color: #dcdcaa; font-weight: bold;">Unable to send OTP</td>
                    <td style="padding: 12px; color: #9cdcfe;">OTP SMS not sending</td>
                    <td style="padding: 12px; color: #858585;">Check this diagnostic first, then use SMS Console to test</td>
                </tr>
            </table>
        </div>
    </div>
</body>
</html>
