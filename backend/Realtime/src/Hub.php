<?php
namespace Myles\Realtime;

use Ratchet\MessageComponentInterface;
use Ratchet\ConnectionInterface;

/**
 * Topic-based pub/sub hub.
 *
 * Browser clients connect via WebSocket and send JSON frames:
 *   { "op": "subscribe",   "topic": "/Admin/payments.php" }
 *   { "op": "unsubscribe", "topic": "/Admin/payments.php" }
 *   { "op": "publish",     "topic": "chat:5", "event": "message", "data": {...} }
 *
 * PHP backend endpoints publish via the internal TCP port (see Publisher.php).
 */
class Hub implements MessageComponentInterface
{
    /** @var \SplObjectStorage<ConnectionInterface, array<string,bool>> */
    private $clients;

    public function __construct()
    {
        $this->clients = new \SplObjectStorage();
    }

    public function onOpen(ConnectionInterface $conn)
    {
        $this->clients->attach($conn, []);
        echo "[+] client {$conn->resourceId} connected (total: " . count($this->clients) . ")\n";
    }

    public function onMessage(ConnectionInterface $from, $msg)
    {
        $data = json_decode($msg, true);
        if (!is_array($data) || empty($data['op'])) return;

        $op = $data['op'];
        $topic = isset($data['topic']) ? (string)$data['topic'] : '';

        if ($op === 'subscribe' && $topic !== '') {
            $subs = $this->clients[$from];
            $subs[$topic] = true;
            $this->clients[$from] = $subs;
            $from->send(json_encode(['op' => 'subscribed', 'topic' => $topic]));
        } elseif ($op === 'unsubscribe' && $topic !== '') {
            $subs = $this->clients[$from];
            unset($subs[$topic]);
            $this->clients[$from] = $subs;
        } elseif ($op === 'publish' && $topic !== '') {
            // Client-originated publish (e.g. chat). Broadcast to all subscribers.
            $this->broadcast($topic, $data['event'] ?? 'message', $data['data'] ?? null, $from);
        }
    }

    public function onClose(ConnectionInterface $conn)
    {
        $this->clients->detach($conn);
        echo "[-] client {$conn->resourceId} disconnected\n";
    }

    public function onError(ConnectionInterface $conn, \Exception $e)
    {
        echo "[!] error: {$e->getMessage()}\n";
        $conn->close();
    }

    /**
     * Called by Publisher (internal TCP) AND by client publish ops.
     */
    public function broadcast(string $topic, string $event = 'update', $data = null, ?ConnectionInterface $except = null): void
    {
        $frame = json_encode([
            'op' => 'event',
            'topic' => $topic,
            'event' => $event,
            'data' => $data,
            'ts' => round(microtime(true) * 1000),
        ]);
        $sent = 0;
        foreach ($this->clients as $client) {
            $subs = $this->clients[$client];
            if (!isset($subs[$topic])) continue;
            if ($except !== null && $client === $except) continue;
            $client->send($frame);
            $sent++;
        }
        echo "[>] broadcast {$topic} ({$event}) -> {$sent} client(s)\n";
    }
}
