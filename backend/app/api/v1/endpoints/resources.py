from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ApiError
from app.db.session import get_db
from app.models import AuditLog, Category, Inventory, Product, StockDocument, StockDocumentItem, StockMovement, Supplier, User, Warehouse
from app.schemas import CategoryCreate, InventoryAdjustmentInput, ProductInput, SupplierInput, UserInput, WarehouseInput
from app.services.serialization import audit_dict, product_dict, supplier_dict, user_dict, warehouse_dict

router = APIRouter()
ACTOR = "Hệ thống"


def add_audit(db: Session, message: str) -> None:
    db.add(AuditLog(message=message, actor_name=ACTOR))


def integrity_error(error: IntegrityError) -> ApiError:
    constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", "") or ""
    if "sku" in constraint:
        return ApiError(409, "DUPLICATE_SKU", "Mã SKU đã được sử dụng.")
    if "barcode" in constraint:
        return ApiError(409, "DUPLICATE_BARCODE", "Barcode đã được sử dụng.")
    if "category" in constraint:
        return ApiError(409, "CATEGORY_IN_USE", "Danh mục đang được sản phẩm sử dụng.")
    if "email" in constraint:
        return ApiError(409, "DUPLICATE_EMAIL", "Email tài khoản đã tồn tại.")
    return ApiError(409, "CONFLICT", "Dữ liệu vi phạm ràng buộc hoặc đã tồn tại.")


def get_category(db: Session, name: str) -> Category:
    category = db.scalar(select(Category).where(func.lower(Category.name) == name.lower()))
    if not category:
        raise ApiError(422, "CATEGORY_NOT_FOUND", f"Không tìm thấy danh mục '{name}'.")
    return category


@router.get("/bootstrap")
def get_bootstrap(db: Session = Depends(get_db)):
    from app.services.serialization import bootstrap_state

    return bootstrap_state(db)


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    return [{"id": str(item.id), "name": item.name} for item in db.scalars(select(Category).order_by(Category.name)).all()]


@router.post("/categories", status_code=201)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db)):
    try:
        with db.begin():
            category = Category(name=payload.name)
            db.add(category)
            db.flush()
            add_audit(db, f"Tạo danh mục {category.name}")
        return {"id": str(category.id), "name": category.name}
    except IntegrityError as error:
        raise integrity_error(error) from error


@router.patch("/categories/by-name/{name}")
def rename_category(name: str, payload: CategoryCreate, db: Session = Depends(get_db)):
    try:
        with db.begin():
            category = db.scalar(select(Category).where(func.lower(Category.name) == name.lower()).with_for_update())
            if not category:
                raise ApiError(404, "CATEGORY_NOT_FOUND", "Không tìm thấy danh mục.")
            previous = category.name
            category.name = payload.name
            add_audit(db, f"Cập nhật danh mục {payload.name}")
            db.flush()
        return {"id": str(category.id), "name": category.name, "previousName": previous}
    except IntegrityError as error:
        raise integrity_error(error) from error


@router.delete("/categories/by-name/{name}", status_code=204)
def delete_category(name: str, db: Session = Depends(get_db)):
    try:
        with db.begin():
            category = db.scalar(select(Category).where(func.lower(Category.name) == name.lower()).with_for_update())
            if not category:
                raise ApiError(404, "CATEGORY_NOT_FOUND", "Không tìm thấy danh mục.")
            if db.scalar(select(Product.id).where(Product.category_id == category.id).limit(1)):
                raise ApiError(409, "CATEGORY_IN_USE", "Danh mục đang được sản phẩm sử dụng, không thể xóa.")
            db.delete(category)
            add_audit(db, f"Xóa danh mục {category.name}")
    except IntegrityError as error:
        raise integrity_error(error) from error


@router.get("/products")
def list_products(
    q: str | None = None,
    category: str | None = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = select(Product).options(selectinload(Product.category))
    if q:
        pattern = f"%{q.strip()}%"
        query = query.where(or_(Product.name.ilike(pattern), Product.sku.ilike(pattern), Product.barcode.ilike(pattern)))
    if category:
        query = query.join(Product.category).where(Category.name == category)
    rows = db.scalars(query.order_by(Product.name).offset((page - 1) * pageSize).limit(pageSize)).all()
    return [product_dict(item) for item in rows]


@router.get("/products/lookup")
def lookup_product(
    code: str | None = Query(default=None, min_length=1, max_length=160),
    barcode: str | None = Query(default=None, min_length=1, max_length=160),
    db: Session = Depends(get_db),
):
    if (code is None) == (barcode is None):
        raise ApiError(422, "LOOKUP_QUERY_INVALID", "Cung cấp chính xác một trong hai tham số code hoặc barcode.")
    if barcode is not None:
        product = db.scalar(
            select(Product).options(selectinload(Product.category)).where(func.btrim(Product.barcode) == barcode.strip())
        )
    else:
        normalized = code.strip().lower()
        product = db.scalar(
            select(Product).options(selectinload(Product.category)).where(
                or_(func.lower(func.btrim(Product.sku)) == normalized, func.lower(func.btrim(Product.barcode)) == normalized)
            )
        )
    if not product:
        message = "Không tìm thấy sản phẩm theo barcode." if barcode is not None else "Không tìm thấy sản phẩm theo barcode hoặc SKU."
        raise ApiError(404, "PRODUCT_NOT_FOUND", message)
    return product_dict(product)


def generate_product_sku(db: Session) -> str:
    while True:
        number = db.scalar(text("SELECT nextval('product_sku_seq')"))
        sku = f"SP-{number:06d}"
        if not db.scalar(select(Product.id).where(func.lower(func.btrim(Product.sku)) == sku.lower()).limit(1)):
            return sku


@router.get("/products/next-sku")
def next_product_sku(db: Session = Depends(get_db)):
    return {"sku": generate_product_sku(db)}


@router.get("/products/{product_id}")
def get_product(product_id: UUID, db: Session = Depends(get_db)):
    product = db.scalar(select(Product).options(selectinload(Product.category)).where(Product.id == product_id))
    if not product:
        raise ApiError(404, "PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.")
    return product_dict(product)


def assign_product(product: Product, payload: ProductInput, category: Category) -> None:
    product.sku = payload.sku or ""
    product.barcode = payload.barcode
    product.name = payload.name
    product.category = category
    product.unit = payload.unit
    product.cost = payload.cost
    product.min_stock = payload.minStock
    product.status = payload.status


@router.post("/products", status_code=201)
def create_product(payload: ProductInput, db: Session = Depends(get_db)):
    try:
        with db.begin():
            category = get_category(db, payload.category)
            sku = payload.sku or generate_product_sku(db)
            product = Product()
            assign_product(product, payload.model_copy(update={"sku": sku}), category)
            db.add(product)
            db.flush()
            add_audit(db, f"Tạo sản phẩm {product.name}")
            db.flush()
            db.refresh(product)
        return product_dict(product)
    except IntegrityError as error:
        raise integrity_error(error) from error


@router.put("/products/{product_id}")
def update_product(product_id: UUID, payload: ProductInput, db: Session = Depends(get_db)):
    if not payload.sku:
        raise ApiError(422, "SKU_REQUIRED", "SKU là bắt buộc khi cập nhật sản phẩm.")
    try:
        with db.begin():
            product = db.scalar(select(Product).where(Product.id == product_id).with_for_update())
            if not product:
                raise ApiError(404, "PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.")
            category = get_category(db, payload.category)
            assign_product(product, payload, category)
            add_audit(db, f"Cập nhật sản phẩm {product.name}")
            db.flush()
            db.refresh(product)
        return product_dict(product)
    except IntegrityError as error:
        raise integrity_error(error) from error


@router.delete("/products/{product_id}", status_code=204)
def delete_product(product_id: UUID, db: Session = Depends(get_db)):
    with db.begin():
        product = db.scalar(select(Product).where(Product.id == product_id).with_for_update())
        if not product:
            raise ApiError(404, "PRODUCT_NOT_FOUND", "Không tìm thấy sản phẩm.")
        has_history = db.scalar(select(StockMovement.id).where(StockMovement.product_id == product_id).limit(1))
        has_document = db.scalar(select(StockDocumentItem.document_id).where(StockDocumentItem.product_id == product_id).limit(1))
        if has_history or has_document:
            raise ApiError(409, "PRODUCT_HAS_HISTORY", "Sản phẩm đã được tham chiếu trong lịch sử hoặc phiếu; hãy ngừng kinh doanh thay vì xóa.")
        db.execute(delete(Inventory).where(Inventory.product_id == product_id))
        db.delete(product)
        add_audit(db, f"Xóa sản phẩm {product.name}")


@router.get("/warehouses")
def list_warehouses(db: Session = Depends(get_db)):
    return [warehouse_dict(item) for item in db.scalars(select(Warehouse).order_by(Warehouse.name)).all()]


@router.post("/warehouses", status_code=201)
def create_warehouse(payload: WarehouseInput, db: Session = Depends(get_db)):
    try:
        with db.begin():
            warehouse = Warehouse(code=payload.code, name=payload.name, address=payload.address, manager_name=payload.manager, status=payload.status)
            db.add(warehouse)
            db.flush()
            add_audit(db, f"Tạo kho {warehouse.name}")
        return warehouse_dict(warehouse)
    except IntegrityError as error:
        raise integrity_error(error) from error


@router.put("/warehouses/{warehouse_id}")
def update_warehouse(warehouse_id: UUID, payload: WarehouseInput, db: Session = Depends(get_db)):
    try:
        with db.begin():
            warehouse = db.scalar(select(Warehouse).where(Warehouse.id == warehouse_id).with_for_update())
            if not warehouse:
                raise ApiError(404, "WAREHOUSE_NOT_FOUND", "Không tìm thấy kho.")
            warehouse.code = payload.code
            warehouse.name = payload.name
            warehouse.address = payload.address
            warehouse.manager_name = payload.manager
            warehouse.status = payload.status
            add_audit(db, f"Cập nhật kho {warehouse.name}")
            db.flush()
        return warehouse_dict(warehouse)
    except IntegrityError as error:
        raise integrity_error(error) from error


@router.delete("/warehouses/{warehouse_id}", status_code=204)
def delete_warehouse(warehouse_id: UUID, db: Session = Depends(get_db)):
    with db.begin():
        warehouse = db.scalar(select(Warehouse).where(Warehouse.id == warehouse_id).with_for_update())
        if not warehouse:
            raise ApiError(404, "WAREHOUSE_NOT_FOUND", "Không tìm thấy kho.")
        has_inventory = db.scalar(select(Inventory.product_id).where(Inventory.warehouse_id == warehouse_id).limit(1))
        has_document = db.scalar(select(StockDocument.id).where(StockDocument.warehouse_id == warehouse_id).limit(1))
        has_movement = db.scalar(select(StockMovement.id).where(StockMovement.warehouse_id == warehouse_id).limit(1))
        if has_inventory or has_document or has_movement:
            raise ApiError(409, "WAREHOUSE_IN_USE", "Kho đã có tồn kho, phiếu hoặc giao dịch; hãy tạm ngưng thay vì xóa.")
        db.delete(warehouse)
        add_audit(db, f"Xóa kho {warehouse.name}")


@router.get("/suppliers")
def list_suppliers(db: Session = Depends(get_db)):
    return [supplier_dict(item) for item in db.scalars(select(Supplier).order_by(Supplier.name)).all()]


@router.post("/suppliers", status_code=201)
def create_supplier(payload: SupplierInput, db: Session = Depends(get_db)):
    try:
        with db.begin():
            supplier = Supplier(**payload.model_dump())
            db.add(supplier)
            db.flush()
            add_audit(db, f"Tạo nhà cung cấp {supplier.name}")
        return supplier_dict(supplier)
    except IntegrityError as error:
        raise integrity_error(error) from error


@router.put("/suppliers/{supplier_id}")
def update_supplier(supplier_id: UUID, payload: SupplierInput, db: Session = Depends(get_db)):
    try:
        with db.begin():
            supplier = db.scalar(select(Supplier).where(Supplier.id == supplier_id).with_for_update())
            if not supplier:
                raise ApiError(404, "SUPPLIER_NOT_FOUND", "Không tìm thấy nhà cung cấp.")
            for field, value in payload.model_dump().items():
                setattr(supplier, field, value)
            add_audit(db, f"Cập nhật nhà cung cấp {supplier.name}")
            db.flush()
        return supplier_dict(supplier)
    except IntegrityError as error:
        raise integrity_error(error) from error


@router.delete("/suppliers/{supplier_id}", status_code=204)
def delete_supplier(supplier_id: UUID, db: Session = Depends(get_db)):
    with db.begin():
        supplier = db.scalar(select(Supplier).where(Supplier.id == supplier_id).with_for_update())
        if not supplier:
            raise ApiError(404, "SUPPLIER_NOT_FOUND", "Không tìm thấy nhà cung cấp.")
        referenced = db.scalar(
            select(StockDocument.id)
            .where(
                StockDocument.type == "Nhập kho",
                or_(StockDocument.supplier_id == supplier_id, StockDocument.partner == supplier.name),
            )
            .limit(1)
        )
        if referenced:
            raise ApiError(409, "SUPPLIER_HAS_HISTORY", "Nhà cung cấp đã có phiếu nhập tham chiếu; không thể xóa.")
        db.delete(supplier)
        add_audit(db, f"Xóa nhà cung cấp {supplier.name}")


@router.get("/users")
def list_users(db: Session = Depends(get_db)):
    return [user_dict(item) for item in db.scalars(select(User).order_by(User.name)).all()]


@router.post("/users", status_code=201)
def create_user(payload: UserInput, db: Session = Depends(get_db)):
    try:
        with db.begin():
            user = User(**payload.model_dump())
            db.add(user)
            db.flush()
            add_audit(db, f"Tạo tài khoản {user.name}")
        return user_dict(user)
    except IntegrityError as error:
        raise integrity_error(error) from error


@router.put("/users/{user_id}")
def update_user(user_id: UUID, payload: UserInput, db: Session = Depends(get_db)):
    try:
        with db.begin():
            user = db.scalar(select(User).where(User.id == user_id).with_for_update())
            if not user:
                raise ApiError(404, "USER_NOT_FOUND", "Không tìm thấy người dùng.")
            for field, value in payload.model_dump().items():
                setattr(user, field, value)
            add_audit(db, f"Cập nhật tài khoản {user.name}")
            db.flush()
        return user_dict(user)
    except IntegrityError as error:
        raise integrity_error(error) from error


@router.get("/inventory")
def list_inventory(warehouseId: UUID | None = None, db: Session = Depends(get_db)):
    query = select(Inventory)
    if warehouseId:
        query = query.where(Inventory.warehouse_id == warehouseId)
    return [
        {"productId": str(item.product_id), "warehouseId": str(item.warehouse_id), "quantity": item.quantity, "location": item.location}
        for item in db.scalars(query).all()
    ]


@router.post("/inventory/adjust")
def adjust_inventory(payload: InventoryAdjustmentInput, db: Session = Depends(get_db)):
    with db.begin():
        product = db.scalar(select(Product).where(Product.id == payload.productId).with_for_update())
        warehouse = db.scalar(select(Warehouse).where(Warehouse.id == payload.warehouseId).with_for_update())
        if not product or not warehouse:
            raise ApiError(404, "INVENTORY_REFERENCE_NOT_FOUND", "Không tìm thấy sản phẩm hoặc kho.")
        row = db.scalar(
            select(Inventory)
            .where(Inventory.product_id == payload.productId, Inventory.warehouse_id == payload.warehouseId)
            .with_for_update()
        )
        current = row.quantity if row else 0
        if current + payload.quantity < 0:
            raise ApiError(409, "INSUFFICIENT_STOCK", f"Điều chỉnh sẽ làm tồn kho âm (hiện có {current}).")
        code = f"DC-{datetime.now(timezone.utc).year}-{uuid4().hex[:8].upper()}"
        if row:
            row.quantity = current + payload.quantity
        else:
            db.add(Inventory(product_id=payload.productId, warehouse_id=payload.warehouseId, quantity=payload.quantity, location="Khu mới"))
        movement = StockMovement(
            code=code,
            movement_type="Điều chỉnh",
            product_id=payload.productId,
            warehouse_id=payload.warehouseId,
            quantity_delta=payload.quantity,
            actor_name=ACTOR,
            source=payload.reason,
        )
        db.add(movement)
        add_audit(db, f"Điều chỉnh tồn kho {code}: {payload.reason}")
        db.flush()
    return {
        "id": str(movement.id), "code": movement.code, "type": movement.movement_type,
        "productId": str(movement.product_id), "warehouseId": str(movement.warehouse_id),
        "quantity": movement.quantity_delta, "actor": movement.actor_name,
        "createdAt": movement.created_at.isoformat(), "source": movement.source,
    }


@router.get("/transactions")
def list_transactions(
    type: str | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = select(StockMovement)
    if type:
        query = query.where(StockMovement.movement_type == type)
    if q:
        pattern = f"%{q.strip()}%"
        query = query.where(or_(StockMovement.code.ilike(pattern), StockMovement.actor_name.ilike(pattern), StockMovement.source.ilike(pattern)))
    rows = db.scalars(query.order_by(StockMovement.created_at.desc()).offset((page - 1) * pageSize).limit(pageSize)).all()
    return [
        {
            "id": str(item.id), "code": item.code, "type": item.movement_type,
            "productId": str(item.product_id), "warehouseId": str(item.warehouse_id),
            "quantity": item.quantity_delta if item.movement_type == "Điều chỉnh" else abs(item.quantity_delta),
            "actor": item.actor_name, "createdAt": item.created_at.isoformat(), "source": item.source,
        }
        for item in rows
    ]
