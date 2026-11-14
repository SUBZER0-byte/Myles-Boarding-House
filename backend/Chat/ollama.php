<?php
declare(strict_types=1);

include __DIR__ . '/../Config/header.php';

header('Content-Type: application/json; charset=utf-8');
http_response_code(410);
echo json_encode([
    'type' => 'error',
    'error_type' => 'retired_endpoint',
    'message' => 'This chatbot endpoint has been retired. Use the Supabase Gemini chatbot.',
], JSON_UNESCAPED_SLASHES);
