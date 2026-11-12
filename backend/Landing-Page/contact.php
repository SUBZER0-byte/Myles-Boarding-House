<?php
include '../Config/db.php';
include '../Config/header.php';
include '../Config/realtime.php';

header('Content-Type: application/json');
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'send': sendMessage(); break;
    default: echo json_encode(['type'=>'error','message'=>'Invalid action']);
}

function sendMessage() {
    global $connect;
    $d = json_decode(file_get_contents('php://input'), true);

    $name    = trim($d['name'] ?? '');
    $email   = trim($d['email'] ?? '');
    $subject = trim($d['subject'] ?? '');
    $message = trim($d['message'] ?? '');

    if (empty($name) || empty($email) || empty($message)) {
        echo json_encode(['type'=>'error','message'=>'Name, email and message are required']);
        return;
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        echo json_encode(['type'=>'error','message'=>'Invalid email format']);
        return;
    }

    $stmt = $connect->prepare("
        INSERT INTO contact_messages (name, email, subject, message, is_read, created_at)
        VALUES (?, ?, ?, ?, 0, NOW())
    ");
    $stmt->bind_param("ssss", $name, $email, $subject, $message);
    $ok = $stmt->execute();
    $stmt->close();
    rt_publish('/Landing-Page/contact.php');
    echo json_encode(['type'=>$ok?'success':'error','message'=>$ok?'Message sent':'Failed to send message']);
}
?>
