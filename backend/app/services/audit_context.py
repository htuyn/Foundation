from sqlalchemy.orm import Session


def set_actor_name(db: Session, name: str | None) -> None:
    db.info["audit_actor_name"] = name.strip() if name and name.strip() else "Hệ thống"


def current_actor_name(db: Session) -> str:
    return db.info.get("audit_actor_name", "Hệ thống")
