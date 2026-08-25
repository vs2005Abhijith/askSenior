from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import uuid
from dotenv import load_dotenv
from sqlalchemy import select

from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from langchain_classic.chains import create_retrieval_chain
from langchain_classic.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate
from job_queue import IngestionJob, SessionLocal, init_db, job_to_dict

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

# Global variable for the RAG chain
rag_chain = None
rag_error = None
database_error = None
admin_ingestion_enabled = os.getenv("ENABLE_ADMIN_INGESTION", "false").lower() == "true"


def require_admin(admin_key: str | None):
    configured_key = os.getenv("ADMIN_API_KEY")
    if not configured_key or admin_key != configured_key:
        raise HTTPException(status_code=401, detail="Invalid admin key.")


def init_chain():
    global rag_chain, rag_error
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
        rag_error = None
        print("RAG Chain initialized successfully!")

    except Exception as e:
        rag_error = str(e)
        print(f"Error initializing chain: {e}")

# Initialize on startup
@app.on_event("startup")
async def startup_event():
    global database_error
    if admin_ingestion_enabled:
        try:
            init_db()
            database_error = None
        except Exception as e:
            database_error = str(e)
            print(f"Error initializing database: {e}")
    else:
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
