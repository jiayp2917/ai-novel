from collections.abc import Generator
from threading import RLock

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, close_all_sessions, sessionmaker

from backend.app.core.config import get_settings


def database_url() -> str:
    db_path = get_settings().app_db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{db_path.as_posix()}"


engine: Engine | None = None
SessionLocal: sessionmaker[Session] | None = None
engine_lock = RLock()


def get_engine() -> Engine:
    global engine
    if engine is None:
        with engine_lock:
            if engine is None:
                engine = create_engine(database_url(), connect_args={"check_same_thread": False, "timeout": 30})
                with engine.connect() as connection:
                    connection.exec_driver_sql("PRAGMA journal_mode=WAL")
                    connection.exec_driver_sql("PRAGMA busy_timeout=30000")
    return engine


def get_session_local() -> sessionmaker[Session]:
    global SessionLocal
    if SessionLocal is None:
        with engine_lock:
            if SessionLocal is None:
                SessionLocal = sessionmaker(bind=get_engine(), autoflush=False, autocommit=False, expire_on_commit=False)
    return SessionLocal


def reset_engine() -> None:
    global engine, SessionLocal
    if SessionLocal is not None:
        close_all_sessions()
    if engine is not None:
        engine.dispose()
    engine = None
    SessionLocal = None


def get_db() -> Generator[Session, None, None]:
    with get_session_local()() as session:
        yield session
