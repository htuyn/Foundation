from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    AuditLog,
    Category,
    Inventory,
    Product,
    StockDocument,
    StockMovement,
    Supplier,
    User,
    Warehouse,
)


def money_value(value: Decimal) -> float:
    return float(value)


def product_dict(product: Product) -> dict[str, Any]:
    return {
        "id": str(product.id),
        "sku": product.sku,
        "barcode": product.barcode or "",
        "name": product.name,
        "category": product.category.name,
        "unit": product.unit,
        "cost": money_value(product.cost),
        "minStock": product.min_stock,
        "status": product.status,
        "createdAt": product.created_at.isoformat(),
    }


def warehouse_dict(warehouse: Warehouse) -> dict[str, Any]:
    return {
        "id": str(warehouse.id),
        "code": warehouse.code,
        "name": warehouse.name,
        "address": warehouse.address,
        "manager": warehouse.manager_name,
        "status": warehouse.status,
    }


def supplier_dict(supplier: Supplier) -> dict[str, Any]:
    return {
        "id": str(supplier.id),
        "code": supplier.code,
        "name": supplier.name,
        "phone": supplier.phone,
        "email": supplier.email,
        "address": supplier.address,
        "active": supplier.active,
    }


def user_dict(user: User) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "active": user.active,
        "createdAt": user.created_at.isoformat(),
    }


def document_dict(document: StockDocument) -> dict[str, Any]:
    return {
        "id": str(document.id),
        "code": document.code,
        "type": document.type,
        "warehouseId": str(document.warehouse_id),
        "supplierId": str(document.supplier_id) if document.supplier_id else None,
        "partner": document.supplier.name if document.supplier else document.partner,
        "createdAt": document.created_at.isoformat(),
        "status": document.status,
        "note": document.note,
        "lines": [
            {
                "productId": str(item.product_id),
                "quantity": item.quantity,
                "unitCost": money_value(item.unit_cost),
            }
            for item in document.items
        ],
    }


def movement_dict(movement: StockMovement) -> dict[str, Any]:
    quantity = movement.quantity_delta if movement.movement_type == "Điều chỉnh" else abs(movement.quantity_delta)
    return {
        "id": str(movement.id),
        "code": movement.code,
        "type": movement.movement_type,
        "productId": str(movement.product_id),
        "warehouseId": str(movement.warehouse_id),
        "quantity": quantity,
        "actor": movement.actor_name,
        "createdAt": movement.created_at.isoformat(),
        "source": movement.source,
    }


def audit_dict(log: AuditLog) -> dict[str, Any]:
    return {
        "id": str(log.id),
        "message": log.message,
        "createdAt": log.created_at.isoformat(),
        "actor": log.actor_name,
    }


def bootstrap_state(db: Session) -> dict[str, Any]:
    products = db.scalars(select(Product).options(selectinload(Product.category)).order_by(Product.name)).all()
    documents = db.scalars(
        select(StockDocument).options(selectinload(StockDocument.items), selectinload(StockDocument.supplier)).order_by(StockDocument.created_at.desc())
    ).all()
    movements = db.scalars(select(StockMovement).order_by(StockMovement.created_at.desc())).all()
    return {
        "products": [product_dict(item) for item in products],
        "warehouses": [warehouse_dict(item) for item in db.scalars(select(Warehouse).order_by(Warehouse.name)).all()],
        "inventory": [
            {
                "productId": str(item.product_id),
                "warehouseId": str(item.warehouse_id),
                "quantity": item.quantity,
                "location": item.location,
            }
            for item in db.scalars(select(Inventory)).all()
        ],
        "documents": [document_dict(item) for item in documents],
        "transactions": [movement_dict(item) for item in movements],
        "suppliers": [supplier_dict(item) for item in db.scalars(select(Supplier).order_by(Supplier.name)).all()],
        "users": [user_dict(item) for item in db.scalars(select(User).order_by(User.name)).all()],
        "categories": list(db.scalars(select(Category.name).order_by(Category.name)).all()),
        "auditLogs": [audit_dict(item) for item in db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc())).all()],
    }
