import express from 'express';
import { randomUUID } from 'node:crypto';
import { trace, SpanStatusCode, metrics } from '@opentelemetry/api';
import { logger } from '@lab/observability/logging';
import { prometheusExporter } from '@lab/observability/tracing';

const app = express();
const PORT = Number(process.env.PORT ?? 3103);

// Middleware: parses incoming JSON bodies into req.body.
// Without this, req.body would be undefined.
app.use(express.json());

// Structured request log. trace_id/span_id are added automatically by the
// logger's mixin (active span context) — no need to pass them around.
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    logger.info(
      {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        duration_ms: Date.now() - startedAt,
      },
      'request completed',
    );
  });
  next();
});

// Tracer for this service. The name shows up as `instrumentationScope` in spans,
// so your own spans are distinguishable from auto-instrumented ones.
const tracer = trace.getTracer('notification-service');

const meter = metrics.getMeter('notification-service');

const notificationsSent = meter.createCounter('notifications.sent', {
  description: 'Notifications sent by type',
});

const notificationDuration = meter.createHistogram('notification.processing.duration', {
  unit: 'ms',
  description: 'Notification handling time',
});

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

// Prometheus scrapes this. The handler is an instance method (needs `this`).
app.get('/metrics', (req, res) => {
  void prometheusExporter.getMetricsRequestHandler(req, res);
});

app.post('/notifications', (req, res) => {
  const startedAt = Date.now();
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

      notificationsSent.add(1, { type });
      notificationDuration.record(Date.now() - startedAt, { type });
      logger.info(
        { order_id: orderId, notification_id: notificationId, type },
        'notification sent',
      );
      res.status(201).json(notification);
    } catch (error) {
      notificationsSent.add(1, { status: 'failed', type });
      notificationDuration.record(Date.now() - startedAt, { status: 'failed', type });
      logger.error({ err: error, order_id: orderId }, 'notification send failed');
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
  logger.info({ port: PORT }, 'notification service listening');
});
