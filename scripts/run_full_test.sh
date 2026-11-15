#!/usr/bin/env bash
# =============================================================================
# run_full_test.sh  –  Quy trình kiểm thử toàn diện: staging -> seed -> login -> KT1-3 -> k6
#
# Cách dùng:
#   cd Foundation
#   bash scripts/run_full_test.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Màu hiển thị
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

write_step() { echo -e "\n${CYAN}==> $1${NC}"; }
write_ok()   { echo -e "    ${GREEN}OK: $1${NC}"; }
write_warn() { echo -e "    ${YELLOW}WARN: $1${NC}"; }
fail()       { echo -e "    ${RED}FAIL: $1${NC}"; exit 1; }

# ===========================================================================
# STEP 0 - Kiểm tra .env
# ===========================================================================
write_step "STEP 0 - Kiểm tra .env"
if [ ! -f ".env" ]; then
    cp .env.example .env
    write_warn "Chưa có file .env - đã copy từ .env.example. Vui lòng kiểm tra mật khẩu rồi chạy lại."
    exit 1
fi
write_ok "File .env tồn tại"

# ===========================================================================
# STEP 1 - Khởi động Docker Compose
# ===========================================================================
write_step "STEP 1 - docker compose up -d --build"
docker compose up -d --build
write_ok "Đang chờ backend sẵn sàng tại http://localhost:8000/health/ready ..."

MAX_WAIT=120
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
    if curl -s -f http://localhost:8000/health/ready >/dev/null 2>&1; then
        break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    echo -n "."
done
echo ""

if [ $ELAPSED -ge $MAX_WAIT ]; then
    fail "Backend chưa sẵn sàng sau $MAX_WAIT giây."
fi
write_ok "Backend đã healthy"

# ===========================================================================
# STEP 2 - Chạy migration Alembic
# ===========================================================================
write_step "STEP 2 - alembic upgrade head"
docker compose exec -T backend alembic upgrade head
write_ok "Migration database hoàn tất"

# ===========================================================================
# STEP 3 - Seed dữ liệu mẫu & tài khoản RBAC
# ===========================================================================
write_step "STEP 3 - docker compose exec backend python -m app.seed_demo"
docker compose exec -T backend python -m app.seed_demo
write_ok "Seed dữ liệu hoàn tất"

# ===========================================================================
# STEP 4 - Đăng nhập tài khoản admin@anphat.com
# ===========================================================================
write_step "STEP 4 - Đăng nhập admin@anphat.com"
LOGIN_URI="http://localhost:8000/api/v1/auth/login"
ADMIN_RESP=$(curl -s -X POST "$LOGIN_URI" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@anphat.com","password":"Admin123!"}')

ADMIN_TOKEN=$(echo "$ADMIN_RESP" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4 || true)
if [ -z "$ADMIN_TOKEN" ]; then
    fail "Đăng nhập admin thất bại: $ADMIN_RESP"
fi
write_ok "admin@anphat.com đăng nhập thành công"

# ===========================================================================
# STEP 5 - Đăng nhập tài khoản viewer@anphat.com
# ===========================================================================
write_step "STEP 5 - Đăng nhập viewer@anphat.com"
VIEWER_RESP=$(curl -s -X POST "$LOGIN_URI" \
    -H "Content-Type: application/json" \
    -d '{"email":"viewer@anphat.com","password":"Viewer123!"}')

VIEWER_TOKEN=$(echo "$VIEWER_RESP" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4 || true)
if [ -z "$VIEWER_TOKEN" ]; then
    fail "Đăng nhập viewer thất bại: $VIEWER_RESP"
fi
write_ok "viewer@anphat.com đăng nhập thành công"

# ===========================================================================
# STEP 6 - Lấy UUID thực tế (Product / Warehouse / Supplier)
# ===========================================================================
write_step "STEP 6 - Lấy UUID thực tế từ database"
AUTH_HDR="Authorization: Bearer $ADMIN_TOKEN"

PRODUCT_ID=$(curl -s -H "$AUTH_HDR" "http://localhost:8000/api/v1/products?pageSize=1" | grep -o '"id":"[^"]*' | head -n1 | cut -d'"' -f4)
WAREHOUSE_ID=$(curl -s -H "$AUTH_HDR" "http://localhost:8000/api/v1/warehouses?pageSize=1" | grep -o '"id":"[^"]*' | head -n1 | cut -d'"' -f4)
SUPPLIER_ID=$(curl -s -H "$AUTH_HDR" "http://localhost:8000/api/v1/suppliers?pageSize=1" | grep -o '"id":"[^"]*' | head -n1 | cut -d'"' -f4)

write_ok "PRODUCT_ID   = $PRODUCT_ID"
write_ok "WAREHOUSE_ID = $WAREHOUSE_ID"
write_ok "SUPPLIER_ID  = $SUPPLIER_ID"

# ===========================================================================
# STEP 7 - KT1: RBAC 403 (Viewer không được phép tạo phiếu)
# ===========================================================================
write_step "STEP 7 - KT1: RBAC 403 Forbidden"
KT1_PAYLOAD=$(cat <<EOF
{
  "type": "Nhập kho",
  "partner": "Test KT1",
  "warehouseId": "$WAREHOUSE_ID",
  "supplierId": "$SUPPLIER_ID",
  "note": "KT1 RBAC test",
  "lines": [{"productId": "$PRODUCT_ID", "quantity": 1, "unitCost": 10000}]
}
EOF
)

KT1_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:8000/api/v1/documents" \
    -H "Authorization: Bearer $VIEWER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$KT1_PAYLOAD")

if [ "$KT1_CODE" -eq 403 ]; then
    write_ok "KT1 ĐẠT: Tài khoản Chỉ xem bị chặn 403 Forbidden đúng thiết kế"
else
    fail "KT1 THẤT BẠI: Nhận mã HTTP $KT1_CODE thay vì 403"
fi

# ===========================================================================
# STEP 8 - KT2: Idempotency (201 -> 200 replay -> 409 conflict)
# ===========================================================================
write_step "STEP 8 - KT2: Idempotency"
THUKHO_RESP=$(curl -s -X POST "$LOGIN_URI" \
    -H "Content-Type: application/json" \
    -d '{"email":"thukho@anphat.com","password":"Thukho123!"}')

THUKHO_TOKEN=$(echo "$THUKHO_RESP" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4 || true)
if [ -z "$THUKHO_TOKEN" ]; then
    # Thử tài khoản scanner@anphat.com
    THUKHO_RESP=$(curl -s -X POST "$LOGIN_URI" \
        -H "Content-Type: application/json" \
        -d '{"email":"scanner@anphat.com","password":"Scanner123!"}')
    THUKHO_TOKEN=$(echo "$THUKHO_RESP" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4 || true)
fi

IDEM_KEY="kt2-$(date +%s)"
IDEM_PAYLOAD_1=$(cat <<EOF
{
  "type": "Nhập kho",
  "partner": "NCC Test KT2",
  "warehouseId": "$WAREHOUSE_ID",
  "supplierId": "$SUPPLIER_ID",
  "note": "KT2 idempotency lan 1",
  "lines": [{"productId": "$PRODUCT_ID", "quantity": 10, "unitCost": 50000}]
}
EOF
)

# Lần 1: Tạo mới -> 201
R1_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:8000/api/v1/documents" \
    -H "Authorization: Bearer $THUKHO_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: $IDEM_KEY" \
    -d "$IDEM_PAYLOAD_1")

if [ "$R1_CODE" -eq 201 ]; then
    write_ok "KT2 Lần 1: HTTP 201 Created"
else
    write_warn "KT2 Lần 1: Nhận mã HTTP $R1_CODE (kỳ vọng 201)"
fi

# Lần 2: Cùng key, cùng payload -> 200 Replay
R2_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:8000/api/v1/documents" \
    -H "Authorization: Bearer $THUKHO_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: $IDEM_KEY" \
    -d "$IDEM_PAYLOAD_1")

if [ "$R2_CODE" -eq 200 ]; then
    write_ok "KT2 Lần 2 (Replay cùng key/body): HTTP 200 OK"
else
    write_warn "KT2 Lần 2: Nhận mã HTTP $R2_CODE (kỳ vọng 200)"
fi

# Lần 3: Cùng key, payload khác -> 409 Conflict
IDEM_PAYLOAD_DIFF=$(cat <<EOF
{
  "type": "Nhập kho",
  "partner": "NCC KHAC",
  "warehouseId": "$WAREHOUSE_ID",
  "supplierId": "$SUPPLIER_ID",
  "note": "KT2 payload khac",
  "lines": [{"productId": "$PRODUCT_ID", "quantity": 99, "unitCost": 1}]
}
EOF
)

R3_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:8000/api/v1/documents" \
    -H "Authorization: Bearer $THUKHO_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: $IDEM_KEY" \
    -d "$IDEM_PAYLOAD_DIFF")

if [ "$R3_CODE" -eq 409 ]; then
    write_ok "KT2 Lần 3 (Cùng key, body khác): HTTP 409 Conflict đúng thiết kế"
else
    fail "KT2 Lần 3 THẤT BẠI: Nhận mã HTTP $R3_CODE thay vì 409"
fi

# ===========================================================================
# STEP 9 - KT3: Audit log ghi nhận rejection
# ===========================================================================
write_step "STEP 9 - KT3: Kiểm tra Audit Log"
AUDIT_RESP=$(curl -s -H "$AUTH_HDR" "http://localhost:8000/api/v1/audit-logs?pageSize=50")
REJECTED_COUNT=$(echo "$AUDIT_RESP" | grep -o '"outcome":"rejected"' | wc -l || true)

if [ "$REJECTED_COUNT" -gt 0 ]; then
    write_ok "KT3 ĐẠT: Tìm thấy $REJECTED_COUNT bản ghi rejected trong Audit Log"
else
    write_warn "KT3: Chưa tìm thấy bản ghi rejected trong audit log"
fi

# ===========================================================================
# STEP 10 - k6 Load Test (2 VU, 60s)
# ===========================================================================
write_step "STEP 10 - Đo tải k6 (2 VU, 60s)"
if command -v k6 &>/dev/null; then
    k6 run \
        --vus 2 --duration 60s \
        -e "PRODUCT_ID=$PRODUCT_ID" \
        -e "WAREHOUSE_ID=$WAREHOUSE_ID" \
        -e "SUPPLIER_ID=$SUPPLIER_ID" \
        -e "AUTH_TOKEN=$THUKHO_TOKEN" \
        -e "BASE_URL=http://localhost:8000" \
        scripts/k6_load_test.js
    write_ok "Đo tải k6 2-VU hoàn tất!"
elif command -v docker &>/dev/null; then
    write_warn "Chưa cài k6 trên máy host. Chạy k6 thông qua Docker (grafana/k6)..."
    docker run --rm \
        --network="host" \
        -v "$PROJECT_ROOT/scripts:/scripts" \
        grafana/k6 run \
        --vus 2 --duration 60s \
        -e "PRODUCT_ID=$PRODUCT_ID" \
        -e "WAREHOUSE_ID=$WAREHOUSE_ID" \
        -e "SUPPLIER_ID=$SUPPLIER_ID" \
        -e "AUTH_TOKEN=$THUKHO_TOKEN" \
        -e "BASE_URL=http://localhost:8000" \
        /scripts/k6_load_test.js
    write_ok "Đo tải k6 2-VU qua Docker hoàn tất!"
else
    write_warn "Không tìm thấy k6 hoặc docker. Cài đặt k6 bằng lệnh: bash scripts/install_k6.sh"
fi

echo -e "\n${CYAN}========================================${NC}"
echo -e "  ${GREEN}Toàn bộ quy trình kiểm thử hoàn tất thành công!${NC}"
echo -e "  Token quản trị viên để sử dụng:"
echo -e "  export TOKEN=\"$ADMIN_TOKEN\""
echo -e "${CYAN}========================================${NC}"
