# Screenshot checklist

Drop the PNGs listed here into this folder. The README already references them.

## Before you capture

- Run the whole stack: `docker compose -f infra/docker-compose.yml up -d`, then `pnpm order`, `pnpm payment`, `pnpm notification`.
- Generate traffic first — a trace list with one lonely request looks empty:
  ```bash
  for i in $(seq 1 5); do
    curl -s -o /dev/null -X POST localhost:3101/orders \
      -H 'content-type: application/json' \
      -d '{"customerId":"c1","amount":42,"item":"book"}'
  done
  ```
- Use a consistent browser theme (dark or light) and the same window width for every shot.
- Crop browser chrome unless the URL/port matters — when it does (Jaeger/Prometheus), keep it visible.
- Never include personal data, tokens, or unrelated tabs.
- Prefer PNG over JPEG for UI text; keep each file under ~500 KB.

## Required shots

### 1. `jaeger-waterfall.png` — hero image

Open <http://localhost:16686>, service `order-service`, **Find Traces**, open a successful trace.

Show:
- the service dropdown and the search panel (proves it is Jaeger),
- the trace header with **trace ID** and span count (~15–20 spans),
- the waterfall with all three services expanded so `order.create`, `payment.process`, `payment.authorize`, and `notification.send` are visible,
- ideally the service colors legend.

Why recruiters care: this is the "one request, three services" picture.

### 2. `jaeger-error-span.png` — error semantics

Run `PAYMENT_FAILURE_RATE=1 pnpm payment`, send one order, open the trace, click `payment.process`.

Show:
- the red/error span,
- **Tags**: `otel.status_code=ERROR`, `error=true`, `payment.id`, `order.id`,
- **Logs/Events**: the `exception` entry with type, message, and stacktrace.

### 3. `jaeger-error-search.png` — search at scale

In Jaeger, search with tag `error=true` (or `otel.status_code=ERROR`) across `payment-service`.

Show the results list with several failed traces and their timestamps. This demonstrates you can *find* failures, not just look at one.

### 4. `prometheus-targets.png` — scrape health

Open <http://localhost:9090/targets>.

Show all three jobs `UP`, with Last Scrape / Duration columns visible.

### 5. `prometheus-rejections.png` — business impact

With `PAYMENT_FAILURE_RATE=0.5` on payment, send ~20 orders, then graph:

```promql
sum by (status) (rate(orders_created_total[1m]))
```

Show both `confirmed` and `rejected` lines, with the query visible above the chart. Include the time range in the top bar.

### 6. `prometheus-p95.png` — degradation without failure

Run `PAYMENT_LATENCY_MS=3000` and graph:

```promql
histogram_quantile(0.95, sum by (le) (rate(order_processing_duration_bucket[5m])))
```

Show the p95 spiking into the seconds while error rate stays flat — if you can capture both panels side by side (Prometheus supports multiple expressions), even better.

### 7. `logs-correlation.png` — the join key

Capture terminal output from all three services for the same request. Either split the terminal into three panes or `grep` one trace ID across saved logs:

```bash
grep <trace_id> /tmp/order.log /tmp/payment.log /tmp/notification.log
```

Show:
- JSON lines with `"service"`, `"trace_id"`, `"span_id"`, `"msg"`,
- the **same `trace_id`** in all three services,
- different `span_id` values.

Optional polish: pretty-print with `jq` while keeping it one line per event.

### 8. `metrics-endpoint.png` — raw exposition

```bash
curl -s localhost:3101/metrics | grep -E '^(orders_created_total|order_processing_duration_(count|sum|bucket))'
```

Show the Prometheus text format, including `# HELP` / `# UNIT` / `# TYPE` comments and label sets. This proves the metrics are hand-designed, not just auto-generated.

### 9. `compose-ps.png` — infrastructure

```bash
docker compose -f infra/docker-compose.yml ps
```

Show `jaeger` and `prometheus` running with their published ports.

## Optional but high impact

- **`demo.gif`** (10–15 s): send an order in one terminal, switch to Jaeger, refresh, open the new trace. Embed it near the top of the README instead of the static hero. Keep it under ~5 MB.
- **`architecture.png`**: export the Mermaid diagram from the README if you want a static image for slides/LinkedIn.
- **`span-detail.png`**: one expanded `order.create` span showing attributes, events (`notification.delivered`), and duration.
