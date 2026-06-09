from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
from dotenv import load_dotenv

from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from langchain_classic.chains import create_retrieval_chain
from langchain_classic.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate

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

def init_chain():
    global rag_chain
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
        print("RAG Chain initialized successfully!")

    except Exception as e:
        print(f"Error initializing chain: {e}")

# Initialize on startup
@app.on_event("startup")
async def startup_event():
    init_chain()

@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    if rag_chain is None:
        raise HTTPException(status_code=500, detail="Backend is not fully initialized. Check API keys and vector db.")
    
    try:
        # Invoke LangChain RAG pipeline
        response = rag_chain.invoke({"input": request.message})
        return ChatResponse(reply=response.get("answer", "I could not generate an answer."))
    except Exception as e:
        print(f"Error during chat handling: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
def read_root():
    return {"status": "ok", "message": "askSenior API is running."}
