<?php
/**
 * rt_publish('/Admin/payments.php')               -> refetch trigger for subscribers
 * rt_publish('chat:1:2', 'message', [...])        -> push payload directly
 *
 * Also auto-mirrors admin <-> tenant pages so a change made by one role
 * instantly updates the other (e.g. admin marks a payment paid -> tenant sees it).
 */
if (!function_exists('rt_publish')) {

    function rt_publish_raw(string $topic, string $event = 'update', $data = null): void {
        $payload = json_encode(['topic'=>$topic,'event'=>$event,'data'=>$data]) . "\n";
        $fp = @fsockopen('127.0.0.1', 8081, $errno, $errstr, 0.2);
        if (!$fp) return;
        stream_set_timeout($fp, 0, 200000);
        @fwrite($fp, $payload);
        @fclose($fp);
    }

    function rt_publish(string $topic, string $event = 'update', $data = null): void {
        rt_publish_raw($topic, $event, $data);

        // Mirror admin/tenant siblings (same basename across the two areas)
        if (preg_match('#^/(Admin|Tenant)/([\w\-]+)\.php$#', $topic, $m)) {
            $other = $m[1] === 'Admin' ? 'Tenant' : 'Admin';
            rt_publish_raw("/{$other}/{$m[2]}.php", $event, $data);
        }
        // Landing rooms <-> admin rooms (booking, availability)
        if ($topic === '/Landing-Page/rooms.php' || $topic === '/Landing-Page/booking.php') {
            rt_publish_raw('/Admin/rooms.php', $event, $data);
            rt_publish_raw('/Admin/tenants.php', $event, $data);
        }
    }
}
