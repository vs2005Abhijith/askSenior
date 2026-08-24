import os
from dotenv import load_dotenv
from langchain_community.document_loaders import DirectoryLoader, PyMuPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from typing import List
import time

# Load environment variables
load_dotenv()

# Configuration
PDF_DIR = os.getenv("PDF_DIR", "data/pdfs")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME")

def load_documents(directory: str):
    """Loads all PDF documents from the specified directory."""
    print(f"Loading PDFs from {directory}...")
    loader = DirectoryLoader(directory, glob="**/*.pdf", loader_cls=PyMuPDFLoader)
    documents = loader.load()
    print(f"Loaded {len(documents)} document(s).")
    return documents

def split_documents(documents: List):
    """Splits documents into smaller chunks for vectorization."""
    print("Splitting documents into chunks...")
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        length_function=len,
        is_separator_regex=False,
    )
    chunks = text_splitter.split_documents(documents)
    print(f"Split into {len(chunks)} chunk(s).")
    return chunks

def ingest_to_pinecone():
    """Main pipeline to extract, split, and ingest to Pinecone."""
    if not PINECONE_INDEX_NAME:
        print("Error: PINECONE_INDEX_NAME is not set in .env")
        return

    # 1. Provide embedding model
    print("Initializing Google Generative AI Embeddings...")
    embeddings = GoogleGenerativeAIEmbeddings(model="gemini-embedding-001")

    # 2. Extract and chunk PDFs
    docs = load_documents(PDF_DIR)
    if not docs:
        print("No PDFs found. Please place PDFs in the data/pdfs directory.")
        return
        
    chunks = split_documents(docs)
    
    # Restrict removed to allow full ingestion
    # chunks = chunks[:60]

    # 3. Upload to Pinecone
    print(f"Uploading chunks to Pinecone index: '{PINECONE_INDEX_NAME}'...")
    print("This may take a while depending on the size of your PDFs, please wait.")
    
    vectorstore = PineconeVectorStore(index_name=PINECONE_INDEX_NAME, embedding=embeddings)
    
    # Process in small batches with sleep to respect free-tier Gemini API quotas
    batch_size = 20
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i+batch_size]
        print(f"Uploading batch {i//batch_size + 1}/{(len(chunks)//batch_size) + 1}...")
        try:
            vectorstore.add_documents(batch)
            time.sleep(3) # Wait between batches
        except Exception as e:
            print(f"Rate limit hit: {e}. Cooling down for 40 seconds...")
            time.sleep(40)
            vectorstore.add_documents(batch)
            
    print("Ingestion complete! Your documents are now ready to be queried.")

if __name__ == "__main__":
    ingest_to_pinecone()
