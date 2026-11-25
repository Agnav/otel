import pino from 'pino';
import { trace } from '@opentelemetry/api';

// OTEL_SERVICE_NAME is already set by each dev script — reuse it so
// logs and spans agree on which service this is.
const serviceName = process.env.OTEL_SERVICE_NAME ?? 'unknown-service';

export const logger = pino({

  // fatal | error | warn | info | debug | trace  (env-controlled)
  level: process.env.LOG_LEVEL ?? 'info',

  // `base` replaces pino's default {pid, hostname} with the fields WE want on every line.
  base: { service: serviceName },

  // Default pino time is epoch millis. ISO is friendlier to read and sort.
  timestamp: pino.stdTimeFunctions.isoTime,

  // Called on EVERY log call — this is how trace context enters the logs.
  mixin() {
    const span = trace.getActiveSpan();
    if (!span) return {}; // no active span → no trace fields (e.g. startup logs)
    const { traceId, spanId } = span.spanContext();
    return { trace_id: traceId, span_id: spanId };
  },
});