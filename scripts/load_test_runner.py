"""
Load Test Runner (Python alternative to k6) – SV4 Smart Warehouse
Mô phỏng 2 -> 4 -> 8 -> 16 điểm quét đồng thời gọi API tạo phiếu và đọc tồn kho.
Bổ sung: thu thập CPU/RAM qua docker stats song song trong quá trình đo tải.

Sử dụng:
    python scripts/load_test_runner.py --vus 2 --duration 30
    python scripts/load_test_runner.py --all
"""

import argparse
import concurrent.futures
import json
import math
import random
import subprocess
import sys
import threading
import time
import uuid
from collections import Counter
from datetime import datetime
import requests

NHAN_VIEN_ID = "36a45099-c617-5970-9e62-356c301a16bb"
BACKEND_CONTAINER = "foundation-backend-1"

# Credentials để login lấy Bearer token
NHAN_VIEN_EMAIL    = "thukho@anphat.com"
NHAN_VIEN_PASSWORD = "Demo@1234"
_bearer_token: str = ""


def get_auth_headers() -> dict:
    """Đăng nhập một lần, trả về header Authorization dùng cho toàn bộ load test."""
    global _bearer_token
    if _bearer_token:
        return {"Authorization": f"Bearer {_bearer_token}"}
    try:
        res = requests.post(
            "http://localhost:8000/api/v1/auth/login",
            json={"email": NHAN_VIEN_EMAIL, "password": NHAN_VIEN_PASSWORD},
            timeout=10,
        )
        if res.status_code == 200:
            _bearer_token = res.json().get("accessToken", "")
            print(f"✔ Đăng nhập thành công ({NHAN_VIEN_EMAIL})")
            return {"Authorization": f"Bearer {_bearer_token}"}
        else:
            print(f"⚠️ Đăng nhập thất bại ({res.status_code}), thử dùng X-User-ID fallback")
            return {"X-User-ID": NHAN_VIEN_ID}
    except Exception as e:
        print(f"⚠️ Không login được: {e}, dùng X-User-ID fallback")
        return {"X-User-ID": NHAN_VIEN_ID}


# ---------------------------------------------------------------------------
# Thu thập CPU/RAM từ docker stats trong background
# ---------------------------------------------------------------------------

def _collect_docker_stats(container: str, samples: list, stop_event: threading.Event):
    """Thread chạy nền: gọi docker stats --no-stream mỗi 2s, lưu vào samples[]."""
    while not stop_event.is_set():
        try:
            out = subprocess.check_output(
                ["docker", "stats", container, "--no-stream", "--format",
                 "{{.CPUPerc}},{{.MemUsage}}"],
                timeout=5, stderr=subprocess.DEVNULL,
            ).decode().strip()
            if out:
                cpu_str, mem_str = out.split(",", 1)
                cpu = float(cpu_str.replace("%", "").strip())
                # MemUsage dạng "123MiB / 1GiB" → lấy phần trước "/"
                mem_used = mem_str.split("/")[0].strip()
                samples.append({"cpu_pct": cpu, "mem": mem_used})
        except Exception:
            pass
        time.sleep(2)


def sample_resources(container: str, duration: int) -> dict:
    """Khởi chạy thread docker stats song song với load test, trả về thống kê."""
    samples: list = []
    stop_event = threading.Event()
    t = threading.Thread(target=_collect_docker_stats, args=(container, samples, stop_event), daemon=True)
    t.start()
    return samples, stop_event, t


def stop_resource_sampling(samples, stop_event, thread) -> dict:
    stop_event.set()
    thread.join(timeout=5)
    if not samples:
        return {"cpu_avg": None, "cpu_max": None, "mem_at_peak": None}
    cpus = [s["cpu_pct"] for s in samples]
    peak_idx = cpus.index(max(cpus))
    return {
        "cpu_avg": round(sum(cpus) / len(cpus), 1),
        "cpu_max": round(max(cpus), 1),
        "mem_at_peak": samples[peak_idx]["mem"],
    }


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


def _extract_list(resp) -> list:
    """Chuyển response API (list hoặc dict phân trang) thành list."""
    if isinstance(resp, list):
        return resp
    if isinstance(resp, dict):
        for key in ("items", "data", "results", "products", "suppliers", "warehouses"):
            if key in resp and isinstance(resp[key], list):
                return resp[key]
    return []


def fetch_seed_info(base_url):
    headers = get_auth_headers()
    try:
        r_health = requests.get(f"{base_url}/health", timeout=5)
        if r_health.status_code != 200:
            raise RuntimeError(f"Backend healthcheck trả về status {r_health.status_code}")

        prods = _extract_list(requests.get(f"{base_url}/api/v1/products?pageSize=10",   headers=headers, timeout=10).json())
        supps = _extract_list(requests.get(f"{base_url}/api/v1/suppliers?pageSize=10",  headers=headers, timeout=10).json())
        whs   = _extract_list(requests.get(f"{base_url}/api/v1/warehouses?pageSize=10", headers=headers, timeout=10).json())

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
    session.headers.update(get_auth_headers())

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
                    "type": "Nhập kho",
                    "supplierId": random.choice(supp_ids),
                    "warehouseId": random.choice(wh_ids),
                    "note": f"Load test VU={vu_id} iter={iteration}",
                    "partner": "",
                    "lines": [
                        {
                            "productId": random.choice(prod_ids),
                            "quantity": random.randint(1, 5),
                            "unitCost": 50000,
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

    # Bắt đầu thu thập CPU/RAM song song
    samples, stop_event, stats_thread = sample_resources(BACKEND_CONTAINER, duration)

    all_results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=vus) as executor:
        futures = [
            executor.submit(worker_task, i + 1, stop_time, base_url, prod_ids, supp_ids, wh_ids)
            for i in range(vus)
        ]
        for f in concurrent.futures.as_completed(futures):
            all_results.extend(f.result())

    # Dừng thu thập tài nguyên
    res_stats = stop_resource_sampling(samples, stop_event, stats_thread)

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
        "cpu_avg_pct": res_stats["cpu_avg"],
        "cpu_max_pct": res_stats["cpu_max"],
        "mem_at_peak": res_stats["mem_at_peak"],
    }

    print(f"   ✔ Tổng requests: {total_reqs} | Throughput: {metrics['rps']} req/s | Tỷ lệ lỗi: {metrics['error_rate']}%")
    print(f"   ✔ Latency: p50 = {metrics['p50']} ms | p95 = {metrics['p95']} ms | p99 = {metrics['p99']} ms")
    if res_stats["cpu_avg"] is not None:
        print(f"   ✔ CPU: avg={res_stats['cpu_avg']}% max={res_stats['cpu_max']}% | RAM tại đỉnh: {res_stats['mem_at_peak']}")
    else:
        print(f"   ⚠️ Không lấy được CPU/RAM (docker stats không khả dụng trong sandbox)")
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

    print("\n" + "=" * 100)
    print("BẢNG TỔNG HỢP KẾT QUẢ ĐO TẢI (DÙNG ĐIỀN VÀO MC03 & BÁO CÁO CHƯƠNG 5)")
    print("=" * 100)
    print(f"{'VU':<6} {'req/s':<10} {'p50(ms)':<10} {'p95(ms)':<10} {'p99(ms)':<10} {'Lỗi':<8} {'CPU avg':<10} {'CPU max':<10} {'RAM đỉnh':<12}")
    print("-" * 100)
    for m in all_metrics:
        cpu_avg = f"{m['cpu_avg_pct']}%" if m.get("cpu_avg_pct") is not None else "N/A"
        cpu_max = f"{m['cpu_max_pct']}%" if m.get("cpu_max_pct") is not None else "N/A"
        mem = m.get("mem_at_peak") or "N/A"
        print(f"{m['vus']:<6} {m['rps']:<10} {m['p50']:<10} {m['p95']:<10} {m['p99']:<10} {m['error_rate']}%{'':<4} {cpu_avg:<10} {cpu_max:<10} {mem:<12}")
    print("=" * 100)

    output_path = "docs/evidence/load_test_results.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_metrics, f, indent=2, ensure_ascii=False)
    print(f"✔ Đã lưu kết quả chi tiết ra: {output_path}")


if __name__ == "__main__":
    main()

