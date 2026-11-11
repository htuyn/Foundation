/**
 * k6 Load Test Script – Smart Warehouse SV4
 * Mô phỏng 2 điểm quét gọi POST /api/v1/documents (phiếu nhập kho)
 *
 * Chạy:
 *   k6 run scripts/k6_load_test.js
 *   k6 run --vus 4 --duration 60s scripts/k6_load_test.js
 *   k6 run --vus 8 --duration 60s scripts/k6_load_test.js
 *   k6 run --vus 16 --duration 60s scripts/k6_load_test.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

// ─── Custom metrics ─────────────────────────────────────────────────────────
const createDocLatency = new Trend("create_doc_latency_ms", true);
const errorRate       = new Rate("error_rate");

// ─── Test configuration ──────────────────────────────────────────────────────
export const options = {
  // Mặc định: 2 VU = 2 điểm quét song song trong 60 giây
  vus: 2,
  duration: "60s",

  thresholds: {
    // p95 phải < 500 ms ở 2 điểm quét
    "create_doc_latency_ms": ["p(95)<500"],
    // Tỷ lệ lỗi < 1%
    "error_rate": ["rate<0.01"],
  },
};

// ─── Cấu hình ────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";

// UUID nhân viên kho (seed_demo.py) – dùng để gửi X-User-ID header
const NHAN_VIEN_ID = "36a45099-c617-5970-9e62-356c301a16bb";

// ID sản phẩm và nhà cung cấp – lấy từ staging thực tế
// Nếu chưa biết, chạy: curl http://localhost:8000/api/v1/products?pageSize=5
// và: curl http://localhost:8000/api/v1/suppliers?pageSize=5
const PRODUCT_ID  = __ENV.PRODUCT_ID  || "00000000-0000-0000-0000-000000000001"; // THAY bằng UUID thực
const SUPPLIER_ID = __ENV.SUPPLIER_ID || "00000000-0000-0000-0000-000000000002"; // THAY bằng UUID thực
const WAREHOUSE_ID= __ENV.WAREHOUSE_ID|| "00000000-0000-0000-0000-000000000003"; // THAY bằng UUID thực

// ─── Hàm tạo phiếu nhập kho ──────────────────────────────────────────────────
function createInboundDocument(vuId, iteration) {
  const idempotencyKey = `k6-vu${vuId}-iter${iteration}-${Date.now()}`;
  const payload = JSON.stringify({
    type: "PN",
    partner: `Nhà cung cấp VU${vuId}`,
    supplierId: SUPPLIER_ID,
    warehouseId: WAREHOUSE_ID,
    note: `K6 load test VU=${vuId} iter=${iteration}`,
    items: [
      {
        productId: PRODUCT_ID,
        quantity: 1,
        unitPrice: 10000,
      },
    ],
  });

  const headers = {
    "Content-Type": "application/json",
    "X-User-ID": NHAN_VIEN_ID,
    "Idempotency-Key": idempotencyKey,
  };

  const res = http.post(`${BASE_URL}/api/v1/documents`, payload, { headers });
  return res;
}

// ─── Hàm GET inventory (đọc tồn kho) ────────────────────────────────────────
function getInventory() {
  const res = http.get(`${BASE_URL}/api/v1/inventory?pageSize=50`, {
    headers: { "X-User-ID": NHAN_VIEN_ID },
  });
  return res;
}

// ─── Main test logic ─────────────────────────────────────────────────────────
export default function () {
  const vuId     = __VU;
  const iterNum  = __ITER;

  // 70% tạo phiếu, 30% đọc tồn kho – phản ánh thực tế 2 điểm quét
  const rand = Math.random();

  if (rand < 0.7) {
    const res = createInboundDocument(vuId, iterNum);
    createDocLatency.add(res.timings.duration);
    errorRate.add(res.status >= 400 && res.status !== 409);  // 409 idempotency OK

    check(res, {
      "create doc status 2xx or 409": (r) => r.status === 201 || r.status === 409,
      "create doc latency < 1s":      (r) => r.timings.duration < 1000,
    });
  } else {
    const res = getInventory();
    errorRate.add(res.status >= 400);

    check(res, {
      "get inventory status 200": (r) => r.status === 200,
      "get inventory < 300ms":    (r) => r.timings.duration < 300,
    });
  }

  // Nghỉ 0.5–1.5 giây giữa các request (mô phỏng scanner thực tế)
  sleep(0.5 + Math.random());
}

// ─── Summary report ──────────────────────────────────────────────────────────
export function handleSummary(data) {
  const p50  = Math.round(data.metrics.create_doc_latency_ms?.values?.["p(50)"]  || 0);
  const p95  = Math.round(data.metrics.create_doc_latency_ms?.values?.["p(95)"]  || 0);
  const p99  = Math.round(data.metrics.create_doc_latency_ms?.values?.["p(99)"]  || 0);
  const rps  = (data.metrics.http_reqs?.values?.rate || 0).toFixed(2);
  const errs = ((data.metrics.error_rate?.values?.rate || 0) * 100).toFixed(2);

  const summary = `
=== SV4 K6 Load Test Summary ===
VUs (điểm quét): ${data.options?.vus || "?"}
Duration:        ${data.options?.duration || "?"}

Latency (create_doc):
  p50 = ${p50} ms
  p95 = ${p95} ms
  p99 = ${p99} ms

Throughput:      ${rps} req/s
Error rate:      ${errs}%
Total requests:  ${data.metrics.http_reqs?.values?.count || 0}
=================================
`;
  console.log(summary);

  return {
    stdout: summary,
    "docs/evidence/k6_summary_raw.json": JSON.stringify(data, null, 2),
  };
}
