import express from 'express';
import { randomUUID } from 'node:crypto';
import { trace, SpanStatusCode } from '@opentelemetry/api';

const app = express();
const PORT = Number(process.env.PORT ?? 3103);

// Middleware: parses incoming JSON bodies into req.body.
// Without this, req.body would be undefined.
app.use(express.json());

// Tracer for this service. The name shows up as `instrumentationScope` in spans,
// so your own spans are distinguishable from auto-instrumented ones.
const tracer = trace.getTracer('notification-service');

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

  // Manual span #1: the whole notification operation.
  // Anything auto-instrumented inside this callback becomes its child.
  tracer.startActiveSpan('notification.send', (span) => {
    try {
      const notificationId = `notif_${randomUUID()}`;

      span.setAttribute('operation.type', 'notification');
      span.setAttribute('order.id', orderId);
      span.setAttribute('notification.id', notificationId);
      span.setAttribute('notification.type', type);
      span.setAttribute('notification.status', 'sent');

      // Event: a timestamped moment inside the span, with its own attributes.
      span.addEvent('notification.delivered', { 'notification.channel': 'email' });

      const notification: NotificationResponse = {
        notificationId,
        orderId,
        type,
        status: 'sent',
        sentAt: new Date().toISOString(),
      };

      res.status(201).json(notification);
    } catch (error) {
      // Standard convention: records type/message/stacktrace as an `exception` event.
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'notification send failed' });
      res.status(500).json({ error: 'notification_failed' });
    } finally {
      // Mandatory: this SDK's startActiveSpan does NOT end the span for you.
      span.end();
    }
  });
});

app.listen(PORT, () => {
  console.log(`[notification-service] listening on http://localhost:${PORT}`);
});
