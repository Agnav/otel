import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';

const sdk = new NodeSDK({
  // SimpleSpanProcessor: every finished span is exported immediately.
  // (Production uses BatchSpanProcessor — buffered, efficient. We want instant feedback.)
  spanProcessors: [new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() })],

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
console.log('[tracing] otel sdk started (loaded before app code)');

// Graceful shutdown: flush remaining telemetry instead of losing it.
async function shutdown(signal: string): Promise<void> {
  console.log(`[tracing] ${signal} received, flushing telemetry...`);
  await sdk.shutdown();
  console.log('[tracing] telemetry flushed');
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));