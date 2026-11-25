import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';
import {
  CompositePropagator,
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
} from '@opentelemetry/core';

// Lab switch for the Phase 5 exercise: OTEL_PROPAGATION=off disables
// inject/extract and therefore breaks the distributed trace on purpose.
// (The standard OTEL_PROPAGATORS env var is NOT honored by this SDK version,
// so we wire it explicitly here.)
const propagationOff = process.env.OTEL_PROPAGATION === 'off';

const sdk = new NodeSDK({
  // SimpleSpanProcessor: every finished span is exported immediately.
  // (Production uses BatchSpanProcessor — buffered, efficient. We want instant feedback.)
  spanProcessors: [new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() })],

  // THE propagator: this single object is what writes/reads `traceparent`.
  // Empty list = nothing is injected or extracted.
  // W3CTraceContext = trace-id + span-id + flags; W3CBaggage = user-defined key/values.
  textMapPropagator: new CompositePropagator({
    propagators: propagationOff
      ? []
      : [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  }),

  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable low-level noise: fs, tcp, dns spans drown the signal.
      // Re-enable any of these later to see how much the SDK sees.
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
    }),
  ],
});

// Starts the SDK: patches http/express/fetch etc. NOW, before app code loads.
sdk.start();
console.log(`[tracing] otel sdk started (propagation ${propagationOff ? 'OFF' : 'ON'})`);

// Graceful shutdown: flush remaining telemetry instead of losing it.
async function shutdown(signal: string): Promise<void> {
  console.log(`[tracing] ${signal} received, flushing telemetry...`);
  await sdk.shutdown();
  console.log('[tracing] telemetry flushed');
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));