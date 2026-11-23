# -*- coding: utf-8 -*-
"""
show_audit_log.py -- Hien thi Nhat ky Audit Log truc tiep tren terminal
Dung trong buoi bao ve de chung minh he thong GHI VET cac vi pham RBAC.

Cach dung:
    python -X utf8 scripts/show_audit_log.py
    python -X utf8 scripts/show_audit_log.py --all        # Xem toan bo log
    python -X utf8 scripts/show_audit_log.py --filter 403 # Loc theo tu khoa
"""

import json
import sys
import urllib.request
import urllib.error
from datetime import datetime

BASE_URL       = "http://localhost:8000"
ADMIN_EMAIL    = "admin@anphat.com"
ADMIN_PASSWORD = "Admin123!"

# ── Màu ANSI để terminal đẹp hơn ──────────────────────────────────────────────
RED    = "\033[91m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

SEPARATOR = "─" * 70


def login(email: str, password: str) -> str:
    """Đăng nhập và trả về accessToken."""
    payload = json.dumps({"email": email, "password": password}).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/api/v1/auth/login",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
        return data["accessToken"]
    except urllib.error.URLError:
        print(f"{RED}❌ Không kết nối được backend tại {BASE_URL}{RESET}")
        print(f"   → Hãy chạy: {YELLOW}docker compose up -d{RESET} rồi thử lại.")
        sys.exit(1)
    except (KeyError, json.JSONDecodeError) as e:
        print(f"{RED}❌ Đăng nhập thất bại: {e}{RESET}")
        sys.exit(1)


def fetch_audit_logs(token: str, filter_kw: str | None = None) -> list[dict]:
    """Lấy danh sách audit log từ API (tối đa 200 bản ghi mới nhất)."""
    url = f"{BASE_URL}/api/v1/audit-logs?pageSize=200"
    if filter_kw:
        import urllib.parse
        url += f"&q={urllib.parse.quote(filter_kw)}"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = json.loads(e.read())
        print(f"{RED}❌ Lỗi lấy audit log: HTTP {e.code}{RESET}")
        print(json.dumps(body, ensure_ascii=False, indent=2))
        sys.exit(1)


def format_created_at(iso: str) -> str:
    """Chuyển ISO timestamp về định dạng đọc dễ hơn."""
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return iso


def print_log_entry(entry: dict, index: int) -> None:
    """In một dòng audit log với màu sắc phù hợp."""
    message     = entry.get("message", "")
    actor       = entry.get("actorName", "?")
    outcome     = entry.get("outcome", "")
    status_code = entry.get("statusCode")
    created_at  = format_created_at(entry.get("createdAt", ""))
    details     = entry.get("details") or {}

    # Chọn màu theo kết quả
    if status_code in (403, 401) or outcome == "rejected":
        color = RED
        icon  = "🚫"
    elif outcome == "success":
        color = GREEN
        icon  = "✅"
    else:
        color = YELLOW
        icon  = "📋"

    print(f"{color}{icon} [{index:>3}] {created_at} | HTTP {status_code or '---'}{RESET}")
    print(f"      {BOLD}Thông báo:{RESET} {message}")
    print(f"      {BOLD}Người thực hiện:{RESET} {actor}")
    if details:
        role   = details.get("role", "")
        reason = details.get("reason", "")
        if role:
            print(f"      {BOLD}Vai trò:{RESET} {role}")
        if reason:
            print(f"      {BOLD}Lý do:{RESET} {reason}")
    print(f"      {SEPARATOR}")


def main() -> None:
    args       = sys.argv[1:]
    show_all   = "--all" in args
    filter_kw  = None

    # Lấy giá trị sau --filter
    if "--filter" in args:
        idx = args.index("--filter")
        if idx + 1 < len(args):
            filter_kw = args[idx + 1]

    print()
    print(f"{BOLD}{CYAN}{'=' * 70}{RESET}")
    print(f"{BOLD}{CYAN}  📋 NHẬT KÝ AUDIT LOG – Smart Warehouse (SV4 Demo){RESET}")
    print(f"{BOLD}{CYAN}{'=' * 70}{RESET}")

    # ── Đăng nhập Admin để lấy token ─────────────────────────────────────────
    print(f"\n{YELLOW}🔑 Đăng nhập Admin để lấy token...{RESET}")
    token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    print(f"{GREEN}✅ Đăng nhập thành công!{RESET}")

    # ── Lấy log ───────────────────────────────────────────────────────────────
    if show_all:
        print(f"\n{CYAN}📥 Lấy toàn bộ audit log (200 bản ghi mới nhất)...{RESET}\n")
        logs = fetch_audit_logs(token)
    else:
        # Mặc định: chỉ hiển thị log bị từ chối (RBAC 403/401)
        print(f"\n{CYAN}📥 Lấy log vi phạm RBAC (403 / 401)...{RESET}")
        print(f"   → Dùng {YELLOW}--all{RESET} để xem toàn bộ, {YELLOW}--filter <từ_khoá>{RESET} để lọc.\n")
        logs = fetch_audit_logs(token, filter_kw or "RBAC DENY")

    if not logs:
        print(f"{YELLOW}⚠️  Không tìm thấy bản ghi nào phù hợp.{RESET}")
        if not show_all:
            print(f"   → Thử chạy KT3 trước:  {YELLOW}python -X utf8 scripts\\kt3_rbac_403.py{RESET}")
        return

    # ── In từng dòng log ──────────────────────────────────────────────────────
    total_deny = sum(1 for e in logs if e.get("outcome") == "rejected")
    total      = len(logs)

    print(f"{BOLD}Tìm thấy {total} bản ghi", end="")
    if total_deny:
        print(f" (trong đó {RED}{total_deny} vi phạm bị từ chối{RESET}{BOLD})", end="")
    print(f":{RESET}\n")
    print(f"{SEPARATOR}")

    for i, entry in enumerate(logs, start=1):
        print_log_entry(entry, i)

    # ── Tóm tắt cho Hội đồng ─────────────────────────────────────────────────
    print()
    print(f"{BOLD}{CYAN}{'=' * 70}{RESET}")
    print(f"{BOLD}  📊 TÓM TẮT{RESET}")
    print(f"{BOLD}{CYAN}{'=' * 70}{RESET}")
    print(f"  Tổng bản ghi hiển thị : {total}")
    if total_deny:
        print(f"  {RED}Vi phạm bị từ chối (403/401) : {total_deny}{RESET}")
    print()
    print(f"  {BOLD}Giải thích cho Hội đồng:{RESET}")
    print(f"  Mỗi lần tài khoản 'Chỉ xem' cố gọi API thay đổi dữ liệu,")
    print(f"  hệ thống KHÔNG CHỈ từ chối mà còn GHI VẾT vào Audit Log:")
    print(f"  • Ai thực hiện  → actorName")
    print(f"  • Vai trò gì    → details.role")
    print(f"  • Endpoint nào  → details.path  + details.method")
    print(f"  • Thời điểm     → createdAt (server_timestamp)")
    print(f"  • Lý do từ chối → details.reason")
    print()
    print(f"  → Đảm bảo {BOLD}truy vết sau sự cố{RESET} và bằng chứng kiểm toán.")
    print(f"{BOLD}{CYAN}{'=' * 70}{RESET}\n")


if __name__ == "__main__":
    main()
