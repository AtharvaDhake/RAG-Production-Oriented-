# injest.py
import os, re
import fitz  
import tiktoken
from supabase import create_client, Client
from sentence_transformers import SentenceTransformer # <--- NEW IMPORT
from tqdm import tqdm
from dotenv import load_dotenv, find_dotenv

load_dotenv(find_dotenv(usecwd=True))

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

PDF_PATH = "human-nutrition-text.pdf"
DOC_ID = "nutrition-v1" 
BATCH_INSERT = 200

enc = tiktoken.get_encoding("cl100k_base")

def clean_text(t: str) -> str:
    t = t.replace("\r", " ")
    t = re.sub(r"-\s*\n\s*", "", t)
    t = re.sub(r"\s+\n", "\n", t)
    t = re.sub(r"[ \t]+", " ", t)
    return t.replace("\n", " ").strip()

def split_sentences(text: str):
    sents = re.split(r'(?<=[.!?])\s+', text.strip())
    return [s.strip() for s in sents if s.strip()]

def chunk_page_by_sentences(text: str):
    sents = split_sentences(text)
    i = 0
    while i < len(sents):
        piece = sents[i:i + 20]
        if not piece: break
        chunk = " ".join(piece)
        if len(enc.encode(chunk)) >= 50:
            yield chunk
        i += 18

def pdf_pages(path: str):
    doc = fitz.open(path)
    try:
        for i in range(len(doc)):
            yield (i + 1, clean_text(doc[i].get_text("text") or ""))
    finally:
        doc.close()

def main():
    sb: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    # LOAD LOCAL MODEL (Downloads ~400MB the first time, runs instantly after)
    print("Loading Local Embedding Model...")
    model = SentenceTransformer('all-mpnet-base-v2') 

    print(f"Reading and chunking '{PDF_PATH}'...")
    inputs, metas = [], []
    for page, text in pdf_pages(PDF_PATH):
        if not text: continue
        for chunk in chunk_page_by_sentences(text):
            inputs.append(chunk)
            metas.append({"page": page, "source": PDF_PATH})

    print(f"Generated {len(inputs)} chunks.")

    # GENERATE EMBEDDINGS LOCALLY (Super fast, no limits!)
    print("Calculating embeddings on your CPU...")
    # The local model handles batching automatically
    vectors = model.encode(inputs, show_progress_bar=True).tolist() 

    # Prepare Rows
    rows = []
    for idx, (content, emb, meta) in enumerate(zip(inputs, vectors, metas)):
        rows.append({
            "doc_id": DOC_ID,
            "chunk_index": idx,
            "content": content,
            "metadata": meta,
            "embedding": emb
        })

    # Upload to Supabase
    print(f"Cleaning existing data for '{DOC_ID}' in Supabase...")
    sb.table("chunks").delete().eq("doc_id", DOC_ID).execute()

    print(f"Uploading {len(rows)} rows to Supabase...")
    for j in range(0, len(rows), BATCH_INSERT):
        batch_to_upload = rows[j : j + BATCH_INSERT]
        sb.table("chunks").insert(batch_to_upload).execute()

    print("--- Ingestion Complete! Powered by Local AI ---")

if __name__ == "__main__":
    main()