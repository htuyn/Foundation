-- =============================================================================
-- inventory_reconciliation.sql  –  Đối chiếu tồn kho vs. stock_movements ledger
-- =============================================================================
-- Mục đích: Phát hiện bất nhất giữa bảng inventory (tồn kho hiện tại) và
--           stock_movements (sổ cái giao dịch).
--
-- Schema liên quan (đã xác minh từ Neon production 2026-11-14):
--
--   inventory (product_id PK, warehouse_id PK, quantity INT NOT NULL)
--
--   stock_movements (
--     id UUID PK,
--     movement_type TEXT CHECK IN ('Nhập kho', 'Xuất kho', 'Điều chỉnh'),
--     product_id    UUID FK → products,
--     warehouse_id  UUID FK → warehouses,
--     quantity_delta INT NOT NULL  -- (+) = nhập/tăng, (-) = xuất/giảm
--   )
--
-- Logic:  Tồn kho = SUM(quantity_delta) of all movements cho cùng (product, warehouse)
--         Vì quantity_delta đã có dấu (+/-), chỉ cần SUM thẳng.
--
-- Chạy: psql -d warehouse_db -f inventory_reconciliation.sql
--       Hoặc dán thẳng vào Neon SQL Editor
-- =============================================================================


-- ---------------------------------------------------------------------------
-- QUERY 1: Chi tiết từng (product × warehouse) – phát hiện hàng bất nhất
-- ---------------------------------------------------------------------------
-- Kết quả: mỗi dòng là 1 cặp (product, warehouse)
--   inv_quantity   = tồn kho đang lưu trong bảng inventory
--   ledger_total   = SUM(quantity_delta) từ stock_movements (sổ cái)
--   delta          = inv_quantity - ledger_total  → phải = 0 nếu hệ thống nhất quán
--   is_consistent  = TRUE nếu khớp
-- ---------------------------------------------------------------------------
WITH ledger AS (
    SELECT
        sm.product_id,
        sm.warehouse_id,
        SUM(sm.quantity_delta) AS ledger_total
    FROM stock_movements sm
    GROUP BY sm.product_id, sm.warehouse_id
),
inventory_snapshot AS (
    SELECT
        inv.product_id,
        inv.warehouse_id,
        inv.quantity AS inv_quantity
    FROM inventory inv
)
SELECT
    p.sku                                                       AS sku,
    p.name                                                      AS product_name,
    w.code                                                      AS warehouse_code,
    w.name                                                      AS warehouse_name,
    COALESCE(inv.inv_quantity, 0)                               AS inv_quantity,
    COALESCE(led.ledger_total, 0)                               AS ledger_total,
    COALESCE(inv.inv_quantity, 0) - COALESCE(led.ledger_total, 0) AS delta,
    CASE
        WHEN COALESCE(inv.inv_quantity, 0) = COALESCE(led.ledger_total, 0)
        THEN TRUE ELSE FALSE
    END                                                         AS is_consistent
FROM inventory_snapshot inv
FULL OUTER JOIN ledger led
    ON inv.product_id  = led.product_id
    AND inv.warehouse_id = led.warehouse_id
JOIN products   p ON p.id = COALESCE(inv.product_id,  led.product_id)
JOIN warehouses w ON w.id = COALESCE(inv.warehouse_id, led.warehouse_id)
ORDER BY
    is_consistent ASC,   -- Hiển thị bất nhất lên đầu
    ABS(COALESCE(inv.inv_quantity, 0) - COALESCE(led.ledger_total, 0)) DESC,
    p.sku,
    w.code;


-- ---------------------------------------------------------------------------
-- QUERY 2: Tóm tắt tổng quan – bao nhiêu dòng nhất quán / bất nhất
-- ---------------------------------------------------------------------------
WITH ledger AS (
    SELECT product_id, warehouse_id, SUM(quantity_delta) AS ledger_total
    FROM stock_movements
    GROUP BY product_id, warehouse_id
)
SELECT
    COUNT(*)                                                    AS total_pairs,
    COUNT(*) FILTER (
        WHERE inv.quantity = COALESCE(led.ledger_total, 0)
    )                                                           AS consistent_count,
    COUNT(*) FILTER (
        WHERE inv.quantity <> COALESCE(led.ledger_total, 0)
        OR led.ledger_total IS NULL
    )                                                           AS inconsistent_count,
    SUM(inv.quantity)                                           AS total_inv_stock,
    SUM(COALESCE(led.ledger_total, 0))                         AS total_ledger_stock
FROM inventory inv
LEFT JOIN ledger led
    ON inv.product_id  = led.product_id
    AND inv.warehouse_id = led.warehouse_id;


-- ---------------------------------------------------------------------------
-- QUERY 3: Phân tích giao dịch theo loại (Nhập / Xuất / Điều chỉnh)
-- Dùng để kiểm tra công thức: Tồn = Tổng_IN - Tổng_OUT + Tổng_Điều_Chỉnh
-- ---------------------------------------------------------------------------
SELECT
    p.sku,
    p.name                                                                              AS product_name,
    w.code                                                                              AS warehouse_code,
    SUM(CASE WHEN sm.movement_type = 'Nhập kho'   AND sm.quantity_delta > 0
             THEN sm.quantity_delta ELSE 0 END)                                         AS tong_nhap_IN,
    SUM(CASE WHEN sm.movement_type = 'Xuất kho'   AND sm.quantity_delta < 0
             THEN ABS(sm.quantity_delta) ELSE 0 END)                                    AS tong_xuat_OUT,
    SUM(CASE WHEN sm.movement_type = 'Điều chỉnh'
             THEN sm.quantity_delta ELSE 0 END)                                         AS tong_dieu_chinh,
    SUM(sm.quantity_delta)                                                              AS net_tong_cong,
    inv.quantity                                                                        AS ton_kho_hien_tai,
    SUM(sm.quantity_delta) - inv.quantity                                               AS sai_lech
FROM stock_movements sm
JOIN products   p   ON p.id  = sm.product_id
JOIN warehouses w   ON w.id  = sm.warehouse_id
LEFT JOIN inventory inv
    ON inv.product_id  = sm.product_id
    AND inv.warehouse_id = sm.warehouse_id
GROUP BY p.sku, p.name, w.code, inv.quantity
HAVING SUM(sm.quantity_delta) <> COALESCE(inv.quantity, 0)   -- Chỉ hiện bất nhất
ORDER BY ABS(SUM(sm.quantity_delta) - COALESCE(inv.quantity, 0)) DESC
LIMIT 50;


-- ---------------------------------------------------------------------------
-- QUERY 4: Phát hiện giao dịch trùng lặp (idempotency leak)
-- Kiểm tra xem cùng 1 document_id có bị sinh movement 2 lần không
-- ---------------------------------------------------------------------------
SELECT
    sm.document_id,
    sd.code                                         AS document_code,
    sd.status                                       AS document_status,
    sm.product_id,
    p.sku,
    COUNT(*)                                        AS movement_count,
    SUM(sm.quantity_delta)                          AS total_delta
FROM stock_movements sm
JOIN stock_documents sd  ON sd.id = sm.document_id
JOIN products        p   ON p.id  = sm.product_id
WHERE sm.document_id IS NOT NULL
GROUP BY sm.document_id, sd.code, sd.status, sm.product_id, p.sku
HAVING COUNT(*) > 1   -- Chỉ hiện nếu có > 1 movement cho cùng (document, product)
ORDER BY movement_count DESC, sd.code;
