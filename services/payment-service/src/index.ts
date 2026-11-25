import express from 'express';
import { randomUUID } from 'node:crypto';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { logger } from '@lab/observability/logging';

const app = express();
const PORT = Number(process.env.PORT ?? 3102);

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
const tracer = trace.getTracer('payment-service');

interface PaymentResponse {
  paymentId: string;
  orderId: string;
  status: 'succeeded';
  amount: number;
  processedAt: string;
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'payment-service' });
});

app.post('/payments', (req, res) => {
  const { orderId, amount } = (req.body ?? {}) as { orderId?: unknown; amount?: unknown };

  if (typeof orderId !== 'string' || typeof amount !== 'number') {
    res.status(400).json({ error: 'orderId (string) and amount (number) are required' });
    return;
  }

  // Manual span #1: the whole payment operation.
  // Anything auto-instrumented inside this callback becomes its child.
  tracer.startActiveSpan('payment.process', (span) => {
    try {
      const paymentId = `pay_${randomUUID()}`;

      span.setAttribute('operation.type', 'payment');
      span.setAttribute('order.id', orderId);
      span.setAttribute('payment.id', paymentId);
      span.setAttribute('payment.amount', amount);

      // Manual span #2: nested step — "authorize with the bank".
      // A child, because it starts inside payment.process's active context.
      tracer.startActiveSpan('payment.authorize', (authorizeSpan) => {
        try {
          authorizeSpan.setAttribute('payment.amount', amount);
          authorizeSpan.setAttribute('payment.authorized', true);
          // Event: a timestamped moment inside this span, with its own attributes.
          authorizeSpan.addEvent('risk_check_passed', { 'risk.score': 0.12 });
          // debug: useful detail, hidden at the default info level.
          logger.debug({ payment_id: paymentId, amount }, 'payment authorized');
        } finally {
          // Mandatory: this SDK's startActiveSpan does NOT end the span for you.
          authorizeSpan.end();
        }
      });

      // Phase 2: payment always succeeds. Failure simulation arrives in Phase 9.
      const payment: PaymentResponse = {
        paymentId,
        orderId,
        status: 'succeeded',
        amount,
        processedAt: new Date().toISOString(),
      };

      span.setAttribute('payment.status', payment.status);
      span.addEvent('payment.recorded', { 'payment.id': paymentId });
      logger.info(
        { order_id: orderId, payment_id: paymentId, amount, status: payment.status },
        'payment processed',
      );
      res.status(201).json(payment);
    } catch (error) {
      logger.error({ err: error, order_id: orderId }, 'payment processing failed');
      // Standard convention: records type/message/stacktrace as an `exception` event.
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'payment processing failed' });
      res.status(500).json({ error: 'payment_processing_failed' });
    } finally {
      span.end();
    }
  });
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'payment service listening');
});
