import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from sqlalchemy import DateTime, Integer, JSON, LargeBinary, String, Text, create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

load_dotenv()

# Vercel secrets are sometimes pasted with shell quotes. Remove them before
# handing the URL to SQLAlchemy so startup does not fail on a valid Neon URL.
database_url = (os.getenv("DATABASE_URL") or "sqlite:///./asksenior.db").strip()
database_url = database_url.strip("'").strip('"')
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql+psycopg2://", 1)
elif database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+psycopg2://", 1)

connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
engine = create_engine(database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class IngestionJob(Base):
    __tablename__ = "ingestion_jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    filename: Mapped[str] = mapped_column(String(255))
    pdf_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    message: Mapped[str] = mapped_column(Text, default="Queued for ingestion.")
    total_chunks: Mapped[int] = mapped_column(Integer, default=0)
    completed_chunks: Mapped[int] = mapped_column(Integer, default=0)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class SharedChat(Base):
    __tablename__ = "shared_chats"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    messages: Mapped[list] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False, default="application/pdf")
    pdf_data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    department: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    semester: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    module_no: Mapped[str] = mapped_column(String(80), nullable=False, default="General", index=True)
    scheme: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    uploader_name: Mapped[str] = mapped_column(String(120), nullable=False)
    uploader_semester: Mapped[str] = mapped_column(String(40), nullable=False)
    uploader_college: Mapped[str] = mapped_column(String(180), nullable=False)
    uploader_uid: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )


def init_db():
    Base.metadata.create_all(engine)
    if "notes" in inspect(engine).get_table_names():
        note_columns = {column["name"] for column in inspect(engine).get_columns("notes")}
        if "module_no" not in note_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE notes ADD COLUMN module_no VARCHAR(80) NOT NULL DEFAULT 'General'"))


def job_to_dict(job: IngestionJob):
    return {
        "job_id": job.id,
        "filename": job.filename,
        "status": job.status,
        "message": job.message,
        "completed_chunks": job.completed_chunks,
        "total_chunks": job.total_chunks,
        "attempts": job.attempts,
        "next_attempt_at": job.next_attempt_at.isoformat() if job.next_attempt_at else None,
    }
