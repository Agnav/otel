import express from 'express';
import { randomUUID } from 'node:crypto';
import { trace, SpanStatusCode, metrics } from '@opentelemetry/api';
import { logger } from '@lab/observability/logging';
import { prometheusExporter } from '@lab/observability/tracing';

const app = express();
const PORT = Number(process.env.PORT ?? 3101);
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL ?? 'http://localhost:3102';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:3103';

// How long we're willing to wait for payment (client-side deadline).
// AbortSignal.timeout() cancels our wait — the server keeps working.
const PAYMENT_TIMEOUT_MS = Number(process.env.PAYMENT_TIMEOUT_MS ?? 2000);

// Middleware: parses incoming JSON bodies into req.body.
app.use(express.json());

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
const tracer = trace.getTracer('order-service');

const meter = metrics.getMeter('order-service');

// Counter: how many orders reached a final decision. `status` is bounded
// (confirmed/rejected), so it is a safe label. NEVER use order_id here.
const ordersCreated = meter.createCounter('orders.created', {
  description: 'Orders that reached a final decision',
});

// Histogram: latency must be a distribution, not a counter.
const orderDuration = meter.createHistogram('order.processing.duration', {
  unit: 'ms',
  description: 'Order handling time from request to response',
});

// Counter: orders that survived a notification failure (alert-worthy trend).
const notificationFailures = meter.createCounter('order.notification.failures', {
  description: 'Orders confirmed despite a failed notification',
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'order-service' });
});

// Prometheus scrapes this. The handler is an instance method (needs `this`).
app.get('/metrics', (req, res) => {
  void prometheusExporter.getMetricsRequestHandler(req, res);
});

app.post('/orders', async (req, res) => {
  const startedAt = Date.now();
  const recordOutcome = (status: 'confirmed' | 'rejected') => {
    ordersCreated.add(1, { status });
    orderDuration.record(Date.now() - startedAt, { status });
  };

  const { customerId, amount, item } = (req.body ?? {}) as {
    customerId?: unknown;
    amount?: unknown;
    item?: unknown;
  };

  // Parent of the entire business operation. Because we are inside its active
  // context, the fetch calls below become its children instead of siblings.
  await tracer.startActiveSpan('order.create', async (orderSpan) => {
    try {
      orderSpan.setAttribute('operation.type', 'order');

      // --- validation child span ---
      const isValid = tracer.startActiveSpan('order.validate', (validationSpan) => {
        const ok =
          typeof customerId === 'string' &&
          typeof amount === 'number' &&
          typeof item === 'string';
        validationSpan.setAttribute('order.valid', ok);
        validationSpan.end();
        return ok;
      });

      if (!isValid) {
        logger.warn({ reason: 'invalid_payload' }, 'order validation failed');
        recordOutcome('rejected');
        orderSpan.addEvent('order.rejected', { reason: 'invalid_payload' });
        orderSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'invalid order payload' });
        res.status(400).json({
          error: 'customerId (string), amount (number), item (string) are required',
        });
        return;
      }

      const orderId = `ord_${randomUUID()}`;
      orderSpan.setAttribute('order.id', orderId);
      orderSpan.setAttribute('order.amount', amount);
      orderSpan.setAttribute('order.item', item);
      logger.info({ order_id: orderId, amount, item }, 'order created');

      // --- Step A: payment (must succeed, or the whole order fails) ---
      let payment: { paymentId: string; status: string };
      try {
        const response = await fetch(`${PAYMENT_SERVICE_URL}/payments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orderId, amount }),
          // Client-side deadline: abort the wait after N ms.
          signal: AbortSignal.timeout(PAYMENT_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new Error(`payment service responded with HTTP ${response.status}`);
        }
        payment = (await response.json()) as { paymentId: string; status: string };
        orderSpan.setAttribute('payment.id', payment.paymentId);
        orderSpan.setAttribute('payment.status', payment.status);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        // TimeoutError is a DOMException (not an Error), hence the negative check.
        const timeout = !(error instanceof Error) || error.name === 'TimeoutError';
        logger.error({ err: error, order_id: orderId, timeout }, 'payment failed');
        recordOutcome('rejected');
        // Standard convention: records type/message/stacktrace as an `exception` event.
        orderSpan.recordException(error as Error);
        orderSpan.setStatus({ code: SpanStatusCode.ERROR, message: detail });
        orderSpan.setAttribute('order.status', 'rejected');
        // 502: we are fine, but a server we depend on is not
        res.status(502).json({ orderId, status: 'rejected', error: 'payment_unavailable', detail });
        return;
      }

      // --- Step B: notification (best effort — order stays confirmed even if this fails) ---
      let notification: { notificationId?: string; status: string; detail?: string };
      try {
        const response = await fetch(`${NOTIFICATION_SERVICE_URL}/notifications`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orderId, type: 'order_confirmation' }),
        });
        if (!response.ok) {
          throw new Error(`notification service responded with HTTP ${response.status}`);
        }
        notification = (await response.json()) as { notificationId: string; status: string };
        orderSpan.setAttribute('notification.status', notification.status);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn({ err: error, order_id: orderId }, 'notification failed, order still confirmed');
        notificationFailures.add(1);
        notification = { status: 'unavailable', detail }; // order still confirmed
        // Order survives a failed notification — so: event + attribute, but NOT an ERROR status.
        orderSpan.addEvent('notification.failed', { 'error.message': detail });
        orderSpan.setAttribute('notification.status', 'unavailable');
      }

      orderSpan.setAttribute('order.status', 'confirmed');
      recordOutcome('confirmed');
      logger.info(
        { order_id: orderId, payment_id: payment.paymentId, notification_status: notification.status },
        'order confirmed',
      );
      res.status(201).json({
        orderId,
        status: 'confirmed',
        customerId,
        item,
        payment,
        notification,
      });
    } finally {
      // Mandatory: this SDK's startActiveSpan does NOT end the span for you.
      orderSpan.end();
    }
  });
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'order service listening');
});
