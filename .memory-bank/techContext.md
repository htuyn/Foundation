# Technical Context

## Công nghệ
- Frontend: React 18, TypeScript 5.6, Vite, React Router 7, Recharts, Lucide, ZXing.
- Backend: Python 3.12+, FastAPI, Pydantic Settings, SQLAlchemy 2.x, Alembic, psycopg 3.
- Database: PostgreSQL 16 (Docker Compose).
- Kiểm thử backend: pytest và httpx; có contract/validation tests cùng PostgreSQL integration tests.

## Lệnh phát triển
```bash
npm install
npm run dev
npm run build
```

Backend trực tiếp (xem `README.md` để biết cấu hình môi trường):
```bash
cd backend
python -m pip install -r requirements.txt
python -m pytest -q
```

Docker Compose khởi động PostgreSQL và backend; chạy `docker compose exec backend alembic upgrade head` để áp migration. Frontend chạy riêng bằng `npm run dev`.

## Cấu hình chính
- Root `.env.example`: cấu hình compose và `VITE_API_BASE_URL`.
- `backend/.env.example`: cấu hình backend.
- Không commit `.env`; cần đặt `POSTGRES_PASSWORD` local.
- Backend mặc định API prefix `/api/v1`, health `/health`, readiness `/health/ready`.

## Kiểm tra trạng thái
`docs/integration-audit.md` ghi nhận audit ngày 2026-10-10: build frontend và 14 backend tests trong container đã đạt tại thời điểm audit; đây không phải kết quả chạy lại trong lần cập nhật Memory Bank này. Camera thiết bị thật, WebSocket handshake và browser E2E chưa được xác minh.
