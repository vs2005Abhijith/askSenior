from fastapi import FastAPI, File, Form, Header, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import os
import re
import secrets
import time
import uuid
from urllib.request import urlopen
from dotenv import load_dotenv
from sqlalchemy import select

from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from langchain_classic.chains import create_retrieval_chain
from langchain_classic.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate
import jwt

from job_queue import IngestionJob, Note, SessionLocal, SharedChat, init_db, job_to_dict

load_dotenv()

app = FastAPI()

# Allow frontend to access API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models for request/response
class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    reply: str


class SharedMessage(BaseModel):
    role: str
    text: str


class ShareChatRequest(BaseModel):
    messages: list[SharedMessage]


class ShareChatResponse(BaseModel):
    share_id: str


class SharedChatResponse(BaseModel):
    messages: list[SharedMessage]


class NoteResponse(BaseModel):
    id: str
    filename: str
    department: str
    semester: str
    subject: str
    module_no: str
    scheme: str
    uploader_name: str
    uploader_semester: str
    uploader_college: str
    created_at: str


class QuizRequest(BaseModel):
    subject: str
    topic: str
    question_count: int = 5


class QuizQuestion(BaseModel):
    question: str
    options: list[str]
    answer_index: int
    explanation: str


class QuizResponse(BaseModel):
    subject: str
    topic: str
    questions: list[QuizQuestion]

# Global variable for the RAG chain
rag_chain = None
rag_error = None
database_error = None
admin_ingestion_enabled = os.getenv("ENABLE_ADMIN_INGESTION", "false").lower() == "true"
quiz_llm = None
quiz_retriever = None
firebase_certificates = {}
firebase_certificates_expires_at = 0


def refresh_firebase_certificates():
    global firebase_certificates, firebase_certificates_expires_at
    with urlopen(
        "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
        timeout=5,
    ) as response:
        firebase_certificates = json.loads(response.read())
    firebase_certificates_expires_at = time.time() + 3600


def verify_firebase_user(authorization: str | None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sign in to upload notes.")

    token = authorization.removeprefix("Bearer ").strip()
    project_id = (os.getenv("FIREBASE_PROJECT_ID") or "asksenior-51f7e").strip().strip("'\"")
    try:
        header = jwt.get_unverified_header(token)
        key_id = header.get("kid")
        if not key_id:
            raise ValueError("The Firebase token has no key id.")

        if time.time() >= firebase_certificates_expires_at:
            refresh_firebase_certificates()

        certificate = firebase_certificates.get(key_id)
        if not certificate:
            refresh_firebase_certificates()
            certificate = firebase_certificates.get(key_id)
        if not certificate:
            raise ValueError("The Firebase token key is not available. Check Firebase project configuration.")
        claims = jwt.decode(
            token,
            certificate,
            algorithms=["RS256"],
            audience=project_id,
            issuer=f"https://securetoken.google.com/{project_id}",
        )
        return claims["sub"]
    except (jwt.PyJWTError, KeyError, ValueError, OSError) as error:
        print(f"Firebase token verification failed: {error}")
        raise HTTPException(status_code=401, detail="Firebase sign-in verification failed. Confirm FIREBASE_PROJECT_ID is configured on the backend, then sign in again.") from error


def note_to_dict(note: Note):
    return {
        "id": note.id,
        "filename": note.filename,
        "department": note.department,
        "semester": note.semester,
        "subject": note.subject,
        "module_no": note.module_no,
        "scheme": note.scheme,
        "uploader_name": note.uploader_name,
        "uploader_semester": note.uploader_semester,
        "uploader_college": note.uploader_college,
        "created_at": note.created_at.isoformat(),
    }


def require_admin(admin_key: str | None):
    configured_key = os.getenv("ADMIN_API_KEY")
    if not configured_key or admin_key != configured_key:
        raise HTTPException(status_code=401, detail="Invalid admin key.")


def init_chain():
    global rag_chain, rag_error, quiz_llm, quiz_retriever
    try:
        index_name = os.getenv("PINECONE_INDEX_NAME")
        if not index_name:
            print("Warning: PINECONE_INDEX_NAME not set.")
            return

        print("Initializing LLM and Vector Store...")
        
        # 1. Initialize LLM
        # We use gemini-2.5-flash for faster responses
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            temperature=0.2, # Low temp for factual answers
        )
        
        # 2. Get embeddings and connect to Pinecone
        embeddings = GoogleGenerativeAIEmbeddings(model="gemini-embedding-001")
        vectorstore = PineconeVectorStore(index_name=index_name, embedding=embeddings)
        retriever = vectorstore.as_retriever(search_kwargs={"k": 5}) # Top 5 relevant chunks
        
        # 3. Create the prompt template
        system_prompt = (
            "You are 'askSenior', an intelligent AI assistant helping a B.Tech CSE student (KTU syllabus).\n"
            "Use the following pieces of retrieved context to answer the question.\n"
            "If the answer is not contained within the provided context, politely state that you cannot answer it based on the notes rather than hallucinating.\n"
            "Use markdown formatting to structures your answers, use bolding for important terms.\n"
            "\n\n"
            "Context:\n"
            "{context}"
        )
        prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "{input}"),
        ])
        
        # 4. Create chains
        question_answer_chain = create_stuff_documents_chain(llm, prompt)
        rag_chain = create_retrieval_chain(retriever, question_answer_chain)
        quiz_llm = llm
        quiz_retriever = retriever
        rag_error = None
        print("RAG Chain initialized successfully!")

    except Exception as e:
        rag_error = str(e)
        print(f"Error initializing chain: {e}")

# Initialize on startup
@app.on_event("startup")
async def startup_event():
    global database_error
    try:
        init_db()
        database_error = None
    except Exception as e:
        database_error = str(e)
        print(f"Error initializing database: {e}")
    if not admin_ingestion_enabled and not database_error:
        database_error = "Admin ingestion is temporarily disabled."
    init_chain()


def require_database():
    if not admin_ingestion_enabled or database_error:
        raise HTTPException(
            status_code=503,
            detail="Admin ingestion is temporarily disabled.",
        )

@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    if rag_chain is None:
        return ChatResponse(reply="The assistant is still initializing. Check the backend environment variables and try again shortly.")
    
    try:
        # Invoke LangChain RAG pipeline
        response = rag_chain.invoke({"input": request.message})
        return ChatResponse(reply=response.get("answer", "I could not generate an answer."))
    except Exception as e:
        print(f"Error during chat handling: {e}")
        return ChatResponse(reply="The assistant could not complete that request. Please try again shortly.")


@app.post("/share", response_model=ShareChatResponse)
async def create_shared_chat(request: ShareChatRequest):
    if not request.messages or len(request.messages) > 100:
        raise HTTPException(status_code=400, detail="A shared chat must contain between 1 and 100 messages.")

    share_id = secrets.token_urlsafe(9)
    messages = [message.model_dump() for message in request.messages]
    try:
        with SessionLocal() as db:
            db.add(SharedChat(id=share_id, messages=messages))
            db.commit()
    except Exception as error:
        print(f"Could not save shared chat: {error}")
        raise HTTPException(status_code=503, detail="Shared chat storage is unavailable.") from error
    return ShareChatResponse(share_id=share_id)


@app.get("/share/{share_id}", response_model=SharedChatResponse)
async def get_shared_chat(share_id: str):
    with SessionLocal() as db:
        shared_chat = db.get(SharedChat, share_id)
    if not shared_chat:
        raise HTTPException(status_code=404, detail="Shared chat not found or expired.")
    return SharedChatResponse(messages=shared_chat.messages)


@app.post("/quiz", response_model=QuizResponse)
async def quiz_endpoint(request: QuizRequest):
    if quiz_llm is None or quiz_retriever is None:
        raise HTTPException(status_code=503, detail="The quiz service is still initializing.")

    question_count = max(3, min(request.question_count, 10))
    try:
        documents = quiz_retriever.invoke(
            f"{request.subject} {request.topic} syllabus concepts definitions and examples"
        )
        context = "\n\n".join(document.page_content for document in documents)
        quiz_prompt = f"""
You are creating a syllabus-based multiple-choice quiz for a KTU B.Tech CSE student.
Subject: {request.subject}
Topic: {request.topic}
Create exactly {question_count} questions using only the study context below.
Each question must have exactly four options and one correct answer.
The answer_index must be zero-based (0, 1, 2, or 3).
Return ONLY valid JSON in this exact shape, with no markdown fences:
{{"questions":[{{"question":"...","options":["...","...","...","..."],"answer_index":0,"explanation":"..."}}]}}

Study context:
{context}
"""
        result = quiz_llm.invoke(quiz_prompt)
        raw_content = result.content if isinstance(result.content, str) else str(result.content)
        raw_content = raw_content.strip().removeprefix("```json").removesuffix("```").strip()
        payload = json.loads(raw_content)
        questions = [QuizQuestion.model_validate(question) for question in payload["questions"]]
        if len(questions) != question_count:
            raise ValueError("The model returned an unexpected number of questions.")
        return QuizResponse(subject=request.subject, topic=request.topic, questions=questions)
    except Exception as error:
        print(f"Error creating quiz: {error}")
        raise HTTPException(status_code=502, detail="Could not create the quiz. Please try again.") from error


@app.post("/notes", response_model=NoteResponse)
async def upload_note(
    file: UploadFile = File(...),
    department: str = Form(...),
    semester: str = Form(...),
    subject: str = Form(...),
    module_no: str = Form(...),
    scheme: str = Form(...),
    uploader_name: str = Form(...),
    uploader_semester: str = Form(...),
    uploader_college: str = Form(...),
    authorization: str | None = Header(default=None),
):
    uploader_uid = verify_firebase_user(authorization)
    values = {
        "department": department.strip(),
        "semester": semester.strip(),
        "subject": subject.strip(),
        "module_no": module_no.strip(),
        "scheme": scheme.strip(),
        "uploader_name": uploader_name.strip(),
        "uploader_semester": uploader_semester.strip(),
        "uploader_college": uploader_college.strip(),
    }
    if any(not value for value in values.values()):
        raise HTTPException(status_code=400, detail="Complete all note details before uploading.")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    contents = await file.read()
    max_size = 10 * 1024 * 1024
    if not contents:
        raise HTTPException(status_code=400, detail="The selected PDF is empty.")
    if len(contents) > max_size:
        raise HTTPException(status_code=413, detail="Notes must be 10 MB or smaller.")

    note = Note(
        id=secrets.token_urlsafe(12),
        filename=file.filename,
        mime_type="application/pdf",
        pdf_data=contents,
        uploader_uid=uploader_uid,
        **values,
    )
    try:
        with SessionLocal() as db:
            db.add(note)
            db.commit()
            db.refresh(note)
            return note_to_dict(note)
    except Exception as error:
        print(f"Could not save note: {error}")
        raise HTTPException(status_code=503, detail="Note storage is unavailable.") from error


@app.get("/notes", response_model=list[NoteResponse])
async def list_notes(
    department: str | None = Query(default=None),
    semester: str | None = Query(default=None),
    subject: str | None = Query(default=None),
    module_no: str | None = Query(default=None),
    scheme: str | None = Query(default=None),
):
    with SessionLocal() as db:
        statement = select(Note).order_by(Note.created_at.desc())
        for column, value in (
            (Note.department, department),
            (Note.semester, semester),
            (Note.subject, subject),
            (Note.module_no, module_no),
            (Note.scheme, scheme),
        ):
            if value and value.strip():
                statement = statement.where(column == value.strip())
        notes = db.scalars(statement).all()
    return [note_to_dict(note) for note in notes]


@app.get("/notes/{note_id}/download")
async def download_note(note_id: str):
    with SessionLocal() as db:
        note = db.get(Note, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")

    safe_filename = re.sub(r"[^A-Za-z0-9._-]+", "_", note.filename).strip("._") or "note.pdf"
    return Response(
        content=note.pdf_data,
        media_type=note.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )


@app.post("/admin/ingest")
async def start_ingestion(
    file: UploadFile = File(...),
    x_admin_key: str | None = Header(default=None),
):
    require_admin(x_admin_key)
    require_database()
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    contents = await file.read()
    max_size = 4 * 1024 * 1024
    if len(contents) > max_size:
        raise HTTPException(status_code=413, detail="PDF must be 4 MB or smaller on this deployment.")

    job = IngestionJob(
        id=uuid.uuid4().hex,
        filename=file.filename,
        pdf_data=contents,
    )
    with SessionLocal() as db:
        db.add(job)
        db.commit()
        db.refresh(job)
        return job_to_dict(job)


@app.get("/admin/ingest/latest")
async def latest_ingestion_status(x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    require_database()
    with SessionLocal() as db:
        job = db.scalar(select(IngestionJob).order_by(IngestionJob.created_at.desc()))
        if not job:
            raise HTTPException(status_code=404, detail="No ingestion jobs found.")
        return job_to_dict(job)


@app.get("/admin/ingest/{job_id}")
async def ingestion_status(job_id: str, x_admin_key: str | None = Header(default=None)):
    require_admin(x_admin_key)
    require_database()
    with SessionLocal() as db:
        job = db.get(IngestionJob, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Ingestion job not found.")
        return job_to_dict(job)

@app.get("/")
def read_root():
    return {
        "status": "ok",
        "message": "askSenior API is running.",
        "rag_initialized": rag_chain is not None,
        "rag_error": rag_error,
        "database_ready": database_error is None,
        "database_error": database_error,
        "admin_ingestion_enabled": admin_ingestion_enabled,
    }
