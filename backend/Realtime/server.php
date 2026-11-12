<?php
/**
 * Run from XAMPP shell:
 *   cd backend/Realtime
 *   composer install
 *   php server.php
 *
 * Public WebSocket:  ws://localhost:8080
 * Internal publisher TCP: 127.0.0.1:8081  (loopback only, PHP backend uses fsockopen)
 */
require __DIR__ . '/vendor/autoload.php';

use Ratchet\Server\IoServer;
use Ratchet\Http\HttpServer;
use Ratchet\WebSocket\WsServer;
use React\EventLoop\Factory as LoopFactory;
use React\Socket\Server as ReactSocket;
use Myles\Realtime\Hub;

$loop = LoopFactory::create();
$hub  = new Hub();

// 1) Public WebSocket for browsers
$wsApp = new HttpServer(new WsServer($hub));
$wsSocket = new ReactSocket('0.0.0.0:8080', $loop);
new IoServer($wsApp, $wsSocket, $loop);
echo "WebSocket listening on ws://0.0.0.0:8080\n";

// 2) Internal TCP for PHP backend publishers (loopback only)
$publishSocket = new ReactSocket('127.0.0.1:8081', $loop);
$publishSocket->on('connection', function ($conn) use ($hub) {
    $buffer = '';
    $conn->on('data', function ($chunk) use (&$buffer, $conn, $hub) {
        $buffer .= $chunk;
        // newline-delimited JSON frames
        while (($pos = strpos($buffer, "\n")) !== false) {
            $line = substr($buffer, 0, $pos);
            $buffer = substr($buffer, $pos + 1);
            $msg = json_decode($line, true);
            if (is_array($msg) && !empty($msg['topic'])) {
                $hub->broadcast(
                    (string)$msg['topic'],
                    (string)($msg['event'] ?? 'update'),
                    $msg['data'] ?? null
                );
            }
        }
        $conn->write("ok\n");
    });
});
echo "Internal publisher TCP listening on 127.0.0.1:8081\n";

$loop->run();
