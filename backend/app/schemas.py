from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ApiSchema(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)


class CategoryCreate(ApiSchema):
    name: str = Field(min_length=1, max_length=160)


class ProductInput(ApiSchema):
    sku: str | None = Field(default=None, max_length=120)
    barcode: str | None = Field(default=None, max_length=160)
    name: str = Field(min_length=1, max_length=240)
    category: str = Field(min_length=1, max_length=160)
    unit: str = Field(default="chiếc", min_length=1, max_length=80)
    cost: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    minStock: int = Field(default=0, ge=0)
    status: Literal["Đang kinh doanh", "Ngừng kinh doanh"] = "Đang kinh doanh"

    @field_validator("sku", mode="before")
    @classmethod
    def clean_sku(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value

    @field_validator("barcode", mode="before")
    @classmethod
    def empty_barcode_is_null(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
        if value == "":
            return None
        return value


class WarehouseInput(ApiSchema):
    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=240)
    address: str = Field(default="", max_length=500)
    manager: str = Field(default="", max_length=180)
    status: Literal["Đang hoạt động", "Tạm ngưng"] = "Đang hoạt động"


class SupplierInput(ApiSchema):
    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=240)
    phone: str = Field(default="", max_length=80)
    email: str = Field(default="", max_length=254)
    address: str = Field(default="", max_length=500)
    active: bool = True


class UserInput(ApiSchema):
    name: str = Field(min_length=1, max_length=180)
    email: str = Field(min_length=3, max_length=254)
    role: Literal["Quản trị viên", "Quản lý kho", "Nhân viên kho"] = "Nhân viên kho"
    active: bool = True


class DocumentLineInput(ApiSchema):
    productId: UUID
    quantity: int = Field(gt=0)
    unitCost: Decimal = Field(ge=0, max_digits=14, decimal_places=2)


class DocumentInput(ApiSchema):
    type: Literal["Nhập kho", "Xuất kho"]
    warehouseId: UUID
    supplierId: UUID | None = None
    partner: str = Field(default="", max_length=300)
    note: str = Field(default="", max_length=4000)
    lines: list[DocumentLineInput] = Field(min_length=1, max_length=500)

    @field_validator("lines")
    @classmethod
    def unique_products_per_document(cls, lines: list[DocumentLineInput]) -> list[DocumentLineInput]:
        product_ids = [line.productId for line in lines]
        if len(product_ids) != len(set(product_ids)):
            raise ValueError("Mỗi sản phẩm chỉ được có một dòng trong phiếu.")
        return lines

    @model_validator(mode="after")
    def validate_partner(self) -> "DocumentInput":
        self.partner = self.partner.strip()
        if self.type == "Nhập kho" and self.supplierId is None:
            raise ValueError("Phiếu nhập kho phải chọn nhà cung cấp.")
        if self.type == "Xuất kho" and not self.partner:
            raise ValueError("Phiếu xuất kho phải có người nhận hoặc mã đơn hàng.")
        if self.type == "Xuất kho" and self.supplierId is not None:
            raise ValueError("Phiếu xuất kho không nhận nhà cung cấp.")
        return self


class InventoryAdjustmentInput(ApiSchema):
    productId: UUID
    warehouseId: UUID
    quantity: int
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator("quantity")
    @classmethod
    def nonzero_quantity(cls, value: int) -> int:
        if value == 0:
            raise ValueError("Số lượng điều chỉnh phải khác 0.")
        return value


class ScannerJoinInput(ApiSchema):
    qrNonce: str = Field(min_length=16, max_length=200)
    deviceName: str = Field(min_length=1, max_length=120)


class ScannerEventInput(ApiSchema):
    eventId: UUID
    sessionId: UUID
    barcode: str = Field(min_length=1, max_length=300)
    format: Literal["EAN_13", "EAN_8", "UPC_A", "UPC_E", "CODE_128", "CODE_39", "QR_CODE", "MANUAL"]
    scannedAt: datetime
    deviceId: str | None = Field(default=None, max_length=200)

    @field_validator("scannedAt")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("scannedAt phải có timezone theo ISO 8601.")
        return value


class ScannerSocketMessage(ApiSchema):
    type: Literal["ping"]
