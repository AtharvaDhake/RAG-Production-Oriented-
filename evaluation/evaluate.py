import os
import json
import requests
import pandas as pd
from datasets import Dataset
from openai import OpenAI
from ragas import evaluate
from ragas.metrics import faithfulness, answer_relevancy, context_precision, context_recall
from ragas.llms import llm_factory
from ragas.embeddings.base import embedding_factory
from dotenv import load_dotenv

# Load environment variables from root
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

# Configuration
BACKEND_URL = "http://13.60.233.161:8081/chat"
GEMINI_MODEL = "gemini-3.1-flash-lite-preview"

def get_rag_response(question):
    """Call the Go backend to get answer and contexts."""
    try:
        response = requests.post(BACKEND_URL, json={"query": question})
        response.raise_for_status()
        data = response.json()
        
        answer = data.get("reply", "")
        # Extract content from citations as contexts
        contexts = [cite.get("text", "") for cite in data.get("citations", [])]
        
        return answer, contexts
    except Exception as e:
        print(f"Error calling backend for question '{question}': {e}")
        return "", []

def main():
    # 1. Load test set (path relative to this script)
    test_set_path = os.path.join(os.path.dirname(__file__), "test_set.json")
    with open(test_set_path, "r") as f:
        test_data = json.load(f)

    print(f"Running evaluation on {len(test_data)} questions...")

    results = []
    for item in test_data:
        question = item["question"]
        ground_truth = item["ground_truth"]
        
        print(f"Evaluating: {question}")
        answer, contexts = get_rag_response(question)
        
        results.append({
            "question": question,
            "answer": answer,
            "contexts": contexts,
            "ground_truth": ground_truth
        })

    # 2. Convert to Ragas Dataset
    df = pd.DataFrame(results)
    dataset = Dataset.from_pandas(df)

    # 3. Setup Gemini via OpenAI-compatible endpoint
    gemini_client = OpenAI(
        api_key=os.getenv("GEMINI_API_KEY"),
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
    )
    llm = llm_factory(GEMINI_MODEL, client=gemini_client)

    # Setup embeddings for AnswerRelevancy (same model as your RAG pipeline)
    embeddings = embedding_factory("huggingface", model="sentence-transformers/all-mpnet-base-v2")

    # 4. Run Evaluation
    print("\nCalculating Ragas metrics...")
    score = evaluate(
        dataset,
        metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
        llm=llm,
        embeddings=embeddings,
    )

    # 5. Show results
    print("\n--- Evaluation Results ---")
    print(score)
    
    # Save results to a CSV in the same folder
    score_df = score.to_pandas()
    output_path = os.path.join(os.path.dirname(__file__), "evaluation_results.csv")
    score_df.to_csv(output_path, index=False)
    print(f"\nDetailed results saved to '{output_path}'")

if __name__ == "__main__":
    if not os.getenv("GEMINI_API_KEY"):
        print("Error: GEMINI_API_KEY not found in environment.")
    else:
        main()
