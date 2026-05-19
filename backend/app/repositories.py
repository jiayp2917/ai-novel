from typing import Any, Generic, TypeVar

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.db.base import Base


ModelT = TypeVar("ModelT", bound=Base)


class Repository(Generic[ModelT]):
    def __init__(self, session: Session, model: type[ModelT]) -> None:
        self.session = session
        self.model = model

    def create(self, data: dict[str, Any]) -> ModelT:
        item = self.model(**data)
        self.session.add(item)
        self.session.flush()
        self.session.refresh(item)
        return item

    def get(self, item_id: int) -> ModelT | None:
        return self.session.get(self.model, item_id)

    def list(self, *, limit: int = 100, offset: int = 0) -> list[ModelT]:
        statement = select(self.model).offset(offset).limit(limit)
        return list(self.session.scalars(statement))

    def update(self, item: ModelT, data: dict[str, Any]) -> ModelT:
        for key, value in data.items():
            setattr(item, key, value)
        self.session.flush()
        self.session.refresh(item)
        return item

    def delete(self, item: ModelT) -> None:
        self.session.delete(item)
        self.session.flush()
