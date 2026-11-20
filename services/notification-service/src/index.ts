import express from 'express';
import { randomUUID } from 'node:crypto';

const app = express();
const PORT = Number(process.env.PORT ?? 3003);

// Middleware: parses incoming JSON bodies into req.body.
// Without this, req.body would be undefined.
app.use(express.json());

interface NotificationResponse {
  notificationId: string;
  orderId: string;
  type: string;
  status: 'sent';
  sentAt: string;
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'notification-service' });
});

app.post('/notifications', (req, res) => {
  const { orderId, type } = (req.body ?? {}) as { orderId?: unknown; type?: unknown };

  if (typeof orderId !== 'string' || typeof type !== 'string') {
    res.status(400).json({ error: 'orderId (string) and type (string) are required' });
    return;
  }

  const notification: NotificationResponse = {
    notificationId: `notif_${randomUUID()}`,
    orderId,
    type,
    status: 'sent',
    sentAt: new Date().toISOString(),
  };

  res.status(201).json(notification);
});

app.listen(PORT, () => {
  console.log(`[notification-service] listening on http://localhost:${PORT}`);
});
