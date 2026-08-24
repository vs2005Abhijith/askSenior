import hashlib
import os
import tempfile
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from langchain_community.document_loaders import PyMuPDFLoader
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy import or_, select

from job_queue import IngestionJob, SessionLocal, init_db


BATCH_SIZE = 20
MAX_ATTEMPTS = 10


def next_google_reset():
    pacific_now = datetime.now(ZoneInfo("America/Los_Angeles"))
    next_day = (pacific_now + timedelta(days=1)).date()
    reset = datetime.combine(next_day, datetime.min.time(), tzinfo=ZoneInfo("America/Los_Angeles"))
    return reset.astimezone(timezone.utc) + timedelta(minutes=5)


def is_quota_error(error: Exception):
    text = str(error).upper()
    return "429" in text or "RESOURCE_EXHAUSTED" in text or "QUOTA" in text


def claim_job():
    now = datetime.now(timezone.utc)
    stale_before = now - timedelta(minutes=10)
    with SessionLocal() as db:
        job = db.scalar(
            select(IngestionJob)
            .where(
                IngestionJob.pdf_data.is_not(None),
                or_(
                    IngestionJob.status == "queued",
                    (IngestionJob.status == "waiting")
                    & (IngestionJob.next_attempt_at <= now),
                    (IngestionJob.status == "processing")
                    & (IngestionJob.updated_at <= stale_before),
                ),
            )
            .order_by(IngestionJob.created_at)
        )
        if not job:
            return None
        job.status = "processing"
        job.attempts += 1
        job.message = "Worker started processing the PDF."
        job.updated_at = now
        db.commit()
        return job.id


def update_job(job_id, **values):
    with SessionLocal() as db:
        job = db.get(IngestionJob, job_id)
        if job:
            for key, value in values.items():
                setattr(job, key, value)
            job.updated_at = datetime.now(timezone.utc)
            db.commit()


def process_job(job_id):
    with SessionLocal() as db:
        job = db.get(IngestionJob, job_id)
        if not job or not job.pdf_data:
            return
        pdf_bytes = job.pdf_data
        filename = job.filename
        completed_chunks = job.completed_chunks

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
            temp_file.write(pdf_bytes)
            temp_path = temp_file.name

        documents = PyMuPDFLoader(temp_path).load()
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
            is_separator_regex=False,
        )
        chunks = splitter.split_documents(documents)
        if not chunks:
            raise ValueError("The PDF did not contain extractable text.")

        update_job(
            job_id,
            total_chunks=len(chunks),
            message=f"Extracted {len(chunks)} chunks. Uploading embeddings.",
        )
        embeddings = GoogleGenerativeAIEmbeddings(model="gemini-embedding-001")
        vectorstore = PineconeVectorStore(
            index_name=os.getenv("PINECONE_INDEX_NAME"),
            embedding=embeddings,
        )
        source_hash = hashlib.sha256(pdf_bytes).hexdigest()[:16]
        for start in range(completed_chunks, len(chunks), BATCH_SIZE):
            batch = chunks[start:start + BATCH_SIZE]
            ids = [f"{source_hash}-{start + offset}" for offset in range(len(batch))]
            vectorstore.add_documents(batch, ids=ids)
            finished = start + len(batch)
            update_job(
                job_id,
                completed_chunks=finished,
                message=f"Uploaded {finished} of {len(chunks)} chunks.",
            )

        update_job(
            job_id,
            status="completed",
            message=f"{filename} is ready for chat.",
            next_attempt_at=None,
            pdf_data=None,
        )
        print(f"Completed ingestion job {job_id}: {filename}")
    except Exception as error:
        with SessionLocal() as db:
            job = db.get(IngestionJob, job_id)
            if not job:
                return
            if is_quota_error(error):
                job.status = "waiting"
                job.next_attempt_at = next_google_reset()
                job.message = f"Embedding quota reached. Automatic retry scheduled for {job.next_attempt_at.isoformat()}."
            elif job.attempts < MAX_ATTEMPTS:
                job.status = "waiting"
                job.next_attempt_at = datetime.now(timezone.utc) + timedelta(minutes=min(60, 2 ** job.attempts))
                job.message = f"Temporary error. Retry {job.attempts}/{MAX_ATTEMPTS} scheduled for {job.next_attempt_at.isoformat()}."
            else:
                job.status = "failed"
                job.message = str(error)
            job.updated_at = datetime.now(timezone.utc)
            db.commit()
        print(f"Ingestion job {job_id} paused: {error}")
    finally:
        if temp_path:
            try:
                os.remove(temp_path)
            except OSError:
                pass


def main():
    init_db()
    print("askSenior ingestion worker is running.")
    while True:
        job_id = claim_job()
        if job_id:
            process_job(job_id)
        else:
            time.sleep(10)


if __name__ == "__main__":
    main()
