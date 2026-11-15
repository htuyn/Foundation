"""Script khởi tạo/cập nhật tài khoản và mật khẩu mặc định cho các tài khoản RBAC demo.

Chạy từ thư mục gốc hoặc backend:
    docker compose exec backend python -m app.seed_rbac
    # hoặc:
    python -m app.seed_rbac
"""
from __future__ import annotations

import sys
from pathlib import Path

# Đảm bảo import được package `app`
_current_file = Path(__file__).resolve()
_backend_dir = _current_file.parent.parent if _current_file.parent.name == "app" else _current_file.parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from app.db.session import SessionLocal
from app.seed_demo import _seed_rbac_users


def main() -> None:
    print("==> Bắt đầu thiết lập tài khoản RBAC demo...")
    with SessionLocal.begin() as session:
        _seed_rbac_users(session)
    print("==> Thiết lập hoàn tất! Bạn có thể dùng các tài khoản trên để đăng nhập ngay.")


if __name__ == "__main__":
    main()
