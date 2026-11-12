"""
Load Test Runner (Python alternative to k6) – SV4 Smart Warehouse
Mô phỏng 2 -> 4 -> 8 -> 16 điểm quét đồng thời gọi API tạo phiếu và đọc tồn kho.

Sử dụng:
    python scripts/load_test_runner.py --vus 2 --duration 30
    python scripts/load_test_runner.py --all
"""

import argparse
import concurrent.futures
import json
import math
import random
import sys
import time
import uuid
from collections import Counter
from datetime import datetime
import requests

NHAN_VIEN_ID = "36a45099-c617-5970-9e62-356c301a16bb"


def get_percentile(sorted_list, p):
    if not sorted_list:
        return 0
    k = (len(sorted_list) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_list[int(k)]
    d0 = sorted_list[int(f)] * (c - k)
    d1 = sorted_list[int(c)] * (k - f)
    return d0 + d1


def fetch_seed_info(base_url):
    headers = {"X-User-ID": NHAN_VIEN_ID}
    try:
        r_health = requests.get(f"{base_url}/health", timeout=5)
        if r_health.status_code != 200:
            raise RuntimeError(f"Backend healthcheck trả về status {r_health.status_code}")

        prods = requests.get(f"{base_url}/api/v1/products?pageSize=10", headers=headers, timeout=10).json()
        supps = requests.get(f"{base_url}/api/v1/suppliers?pageSize=10", headers=headers, timeout=10).json()
        whs   = requests.get(f"{base_url}/api/v1/warehouses?pageSize=10", headers=headers, timeout=10).json()

        if not prods or not supps or not whs:
            raise RuntimeError("Database chưa có dữ liệu sản phẩm/nhà cung cấp/kho. Hãy chạy seed_demo.py trước.")

        prod_ids = [p["id"] for p in prods]
        supp_ids = [s["id"] for s in supps]
        wh_ids   = [w["id"] for w in whs]
        return prod_ids, supp_ids, wh_ids
    except Exception as e:
        print(f"❌ Không thể kết nối tới Backend tại {base_url}: {e}")
        print("💡 Hãy đảm bảo Docker Compose đang chạy (docker-compose up -d).")
        sys.exit(1)


def worker_task(vu_id, stop_time, base_url, prod_ids, supp_ids, wh_ids):
    results = []
    session = requests.Session()
    session.headers.update({"X-User-ID": NHAN_VIEN_ID})

    iteration = 0
    while time.time() < stop_time:
        iteration += 1
        is_write = random.random() < 0.7
        idem_key = f"load-vu{vu_id}-it{iteration}-{uuid.uuid4().hex[:8]}"

        t0 = time.perf_counter()
        status_code = 0
        req_type = "POST /documents" if is_write else "GET /inventory"

        try:
            if is_write:
                payload = {
                    "type": "PN",
                    "partner": f"NCC Test VU{vu_id}",
                    "supplierId": random.choice(supp_ids),
                    "warehouseId": random.choice(wh_ids),
                    "note": f"Load test VU={vu_id} iter={iteration}",
                    "items": [
                        {
                            "productId": random.choice(prod_ids),
                            "quantity": random.randint(1, 5),
                            "unitPrice": 50000,
                        }
                    ],
                }
                res = session.post(
                    f"{base_url}/api/v1/documents",
                    json=payload,
                    headers={"Idempotency-Key": idem_key},
                    timeout=10,
                )
                status_code = res.status_code
            else:
                res = session.get(f"{base_url}/api/v1/inventory?pageSize=50", timeout=10)
                status_code = res.status_code
        except Exception:
            status_code = 599

        duration_ms = (time.perf_counter() - t0) * 1000.0
        results.append((req_type, status_code, duration_ms))

        # Nghỉ nhẹ 0.3 - 0.7s mô phỏng nhịp quét thực tế
        time.sleep(random.uniform(0.3, 0.7))

    return results


def run_benchmark(vus, duration, base_url, prod_ids, supp_ids, wh_ids):
    print(f"\n🚀 Đang chạy kịch bản {vus} điểm quét (VUs) trong {duration} giây...")
    start_time = time.time()
    stop_time = start_time + duration

    all_results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=vus) as executor:
        futures = [
            executor.submit(worker_task, i + 1, stop_time, base_url, prod_ids, supp_ids, wh_ids)
            for i in range(vus)
        ]
        for f in concurrent.futures.as_completed(futures):
            all_results.extend(f.result())

    total_time = time.time() - start_time
    total_reqs = len(all_results)
    if total_reqs == 0:
        print("❌ Không có request nào hoàn thành.")
        return None

    status_counts = Counter(r[1] for r in all_results)
    success_count = sum(c for code, c in status_counts.items() if code in (200, 201, 409))
    error_count = total_reqs - success_count
    error_rate = (error_count / total_reqs) * 100.0
    rps = total_reqs / total_time

    all_latencies = sorted(r[2] for r in all_results)
    write_latencies = sorted(r[2] for r in all_results if r[0] == "POST /documents")
    read_latencies = sorted(r[2] for r in all_results if r[0] == "GET /inventory")

    metrics = {
        "vus": vus,
        "duration": duration,
        "total_requests": total_reqs,
        "rps": round(rps, 2),
        "error_rate": round(error_rate, 2),
        "p50": round(get_percentile(all_latencies, 50), 2),
        "p90": round(get_percentile(all_latencies, 90), 2),
        "p95": round(get_percentile(all_latencies, 95), 2),
        "p99": round(get_percentile(all_latencies, 99), 2),
        "write_p95": round(get_percentile(write_latencies, 95), 2) if write_latencies else 0,
        "read_p95": round(get_percentile(read_latencies, 95), 2) if read_latencies else 0,
        "status_breakdown": dict(status_counts),
    }

    print(f"   ✔ Tổng requests: {total_reqs} | Throughput: {metrics['rps']} req/s | Tỷ lệ lỗi: {metrics['error_rate']}%")
    print(f"   ✔ Latency: p50 = {metrics['p50']} ms | p95 = {metrics['p95']} ms | p99 = {metrics['p99']} ms")
    return metrics


def main():
    parser = argparse.ArgumentParser(description="Load Test Runner – SV4 Smart Warehouse")
    parser.add_argument("--base-url", default="http://localhost:8000", help="Base URL của Backend")
    parser.add_argument("--vus", type=int, default=2, help="Số điểm quét đồng thời")
    parser.add_argument("--duration", type=int, default=30, help="Thời gian chạy mỗi mức (giây)")
    parser.add_argument("--all", action="store_true", help="Chạy toàn bộ chuỗi 2 -> 4 -> 8 -> 16 điểm quét")
    args = parser.parse_args()

    print("=" * 70)
    print("SV4 – CHƯƠNG TRÌNH ĐO TẢI & NGOẠI SUY HỆ THỐNG KHO THÔNG MINH")
    print(f"Thời gian: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    prod_ids, supp_ids, wh_ids = fetch_seed_info(args.base_url)
    print(f"✔ Đã nạp danh mục: {len(prod_ids)} sản phẩm, {len(supp_ids)} nhà cung cấp, {len(wh_ids)} kho.")

    vu_levels = [2, 4, 8, 16] if args.all else [args.vus]
    all_metrics = []

    for v in vu_levels:
        m = run_benchmark(v, args.duration, args.base_url, prod_ids, supp_ids, wh_ids)
        if m:
            all_metrics.append(m)
        if v != vu_levels[-1]:
            print("⏳ Nghỉ 3 giây trước mức tải tiếp theo...")
            time.sleep(3)

    print("\n" + "=" * 80)
    print("BẢNG TỔNG HỢP KẾT QUẢ ĐO TẢI (DÙNG ĐIỀN VÀO MC03 & BÁO CÁO CHƯƠNG 5)")
    print("=" * 80)
    print(f"{'Điểm quét (VU)':<16} {'Throughput (req/s)':<20} {'p50 (ms)':<12} {'p95 (ms)':<12} {'p99 (ms)':<12} {'Error Rate':<12}")
    print("-" * 80)
    for m in all_metrics:
        print(f"{m['vus']:<16} {m['rps']:<20} {m['p50']:<12} {m['p95']:<12} {m['p99']:<12} {m['error_rate']}%")
    print("=" * 80)

    output_path = "docs/evidence/load_test_results.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_metrics, f, indent=2, ensure_ascii=False)
    print(f"✔ Đã lưu kết quả chi tiết ra: {output_path}")


if __name__ == "__main__":
    main()
