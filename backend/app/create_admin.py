import argparse
from getpass import getpass
import re
from sqlalchemy import func, select

from app.core.auth import hash_password
from app.db.session import SessionLocal
from app.models import User


def main() -> None:
    parser = argparse.ArgumentParser(description="Tạo tài khoản quản trị viên đầu tiên hoặc đặt thông tin đăng nhập an toàn.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    args = parser.parse_args()
    email = args.email.strip().lower()
    name = args.name.strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or not name:
        parser.error("Cần email hợp lệ và tên không được để trống.")
    password = getpass("Mật khẩu mới (tối thiểu 12 ký tự): ")
    confirmation = getpass("Nhập lại mật khẩu: ")
    if password != confirmation:
        parser.error("Hai mật khẩu không khớp.")
    password_hash = hash_password(password)
    with SessionLocal.begin() as db:
        active_admin_id = db.scalar(select(User.id).where(User.role == "Quản trị viên", User.active.is_(True)).limit(1))
        user = db.scalar(select(User).where(func.lower(User.email) == email).with_for_update())
        if active_admin_id and (not user or active_admin_id != user.id):
            parser.error("Đã có quản trị viên hoạt động; không thể tạo/nâng quyền quản trị viên khác bằng lệnh bootstrap.")
        if user:
            user.name = name
            user.role = "Quản trị viên"
            user.active = True
            user.password_hash = password_hash
        else:
            db.add(User(name=name, email=email, role="Quản trị viên", active=True, password_hash=password_hash))
    print(f"Đã cấu hình tài khoản quản trị viên: {email}")


if __name__ == "__main__":
    main()
