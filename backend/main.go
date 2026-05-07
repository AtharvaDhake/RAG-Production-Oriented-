package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"

	"github.com/joho/godotenv"
	"github.com/rs/cors"
)

type ChatRequest struct {
	Query string `json:"query"`
}

type Citation struct {
	Text   string `json:"text"`
	Page   int    `json:"page"`
	Source string `json:"source"`
}

type ChatResponse struct {
	Reply     string     `json:"reply"`
	Citations []Citation `json:"citations"`
}

func main() {
	err := godotenv.Load()
	if err != nil {
		log.Println("No .env file found")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/chat", handleChat)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	handler := cors.Default().Handler(mux)

	port := "8081"
	log.Printf("Starting backend server on port %s...", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatalf("could not start server: %v", err)
	}
}

func handleChat(w http.ResponseWriter, r *http.Request) {
	log.Printf("Received %s request for /chat from %s", r.Method, r.RemoteAddr)
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// 1. Get embedding from local python server
	embedReqBody, _ := json.Marshal(map[string]string{"text": req.Query})
	embedRes, err := http.Post("http://localhost:8001", "application/json", bytes.NewBuffer(embedReqBody))
	if err != nil {
		http.Error(w, "Failed to get embedding: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer embedRes.Body.Close()

	var embedData struct {
		Embedding []float64 `json:"embedding"`
	}
	if err := json.NewDecoder(embedRes.Body).Decode(&embedData); err != nil {
		http.Error(w, "Failed to decode embedding", http.StatusInternalServerError)
		return
	}

	// 2. Search Supabase
	supabaseURL := os.Getenv("SUPABASE_URL")
	supabaseKey := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")

	rpcBody, _ := json.Marshal(map[string]interface{}{
		"query_embedding": embedData.Embedding,
		"match_count":     10,
		"match_threshold": 0.70,
		"filter":          map[string]interface{}{},
	})

	supaReq, err := http.NewRequest("POST", supabaseURL+"/rest/v1/rpc/match_documents", bytes.NewBuffer(rpcBody))
	if err != nil {
		http.Error(w, "Failed to create Supabase request", http.StatusInternalServerError)
		return
	}
	supaReq.Header.Set("apikey", supabaseKey)
	supaReq.Header.Set("Authorization", "Bearer "+supabaseKey)
	supaReq.Header.Set("Content-Type", "application/json")

	supaRes, err := http.DefaultClient.Do(supaReq)
	if err != nil {
		http.Error(w, "Failed to call Supabase", http.StatusInternalServerError)
		return
	}
	defer supaRes.Body.Close()

	var matches []struct {
		Content  string `json:"content"`
		Metadata struct {
			Page   int    `json:"page"`
			Source string `json:"source"`
		} `json:"metadata"`
		Similarity float64 `json:"similarity"`
	}
	if err := json.NewDecoder(supaRes.Body).Decode(&matches); err != nil {
		http.Error(w, "Failed to decode Supabase response", http.StatusInternalServerError)
		return
	}

	if len(matches) == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ChatResponse{
			Reply:     "Hello! I couldn't find any highly relevant information about that in the provided documents. Could you please ask a specific question related to the course materials?",
			Citations: []Citation{},
		})
		return
	}

	// 3. Build Prompt for Gemini
	contextText := ""
	var citations []Citation
	for i, m := range matches {
		contextText += fmt.Sprintf("--- Snippet %d ---\n%s\n", i+1, m.Content)
		citations = append(citations, Citation{
			Text:   m.Content,
			Page:   m.Metadata.Page,
			Source: m.Metadata.Source,
		})
	}

	prompt := fmt.Sprintf("You are a helpful AI assistant. Answer the user's question based ONLY on the provided context snippets. Do not make up facts. If the answer is not in the context, say so.\n\nCRITICAL: Format your answer using rich Markdown structure (use headings, bold text, and bullet points where appropriate) so it is extremely easy to read. Do not output raw text blocks.\n\nContext:\n%s\n\nUser Question: %s", contextText, req.Query)

	// 4. Call Gemini API
	geminiKey := os.Getenv("GEMINI_API_KEY")
	geminiURL := "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=" + geminiKey

	geminiReqBody, _ := json.Marshal(map[string]interface{}{
		"contents": []map[string]interface{}{
			{
				"parts": []map[string]interface{}{
					{"text": prompt},
				},
			},
		},
	})

	gemRes, err := http.Post(geminiURL, "application/json", bytes.NewBuffer(geminiReqBody))
	if err != nil {
		http.Error(w, "Failed to call Gemini", http.StatusInternalServerError)
		return
	}
	defer gemRes.Body.Close()

	gemResBytes, _ := io.ReadAll(gemRes.Body)
	log.Printf("Gemini Response Body: %s", string(gemResBytes))
	var gemData map[string]interface{}
	json.Unmarshal(gemResBytes, &gemData)

	// Simple extraction of response text
	reply := "Could not generate response."
	if candidates, ok := gemData["candidates"].([]interface{}); ok && len(candidates) > 0 {
		if cand, ok := candidates[0].(map[string]interface{}); ok {
			if content, ok := cand["content"].(map[string]interface{}); ok {
				if parts, ok := content["parts"].([]interface{}); ok && len(parts) > 0 {
					if part, ok := parts[0].(map[string]interface{}); ok {
						if text, ok := part["text"].(string); ok {
							reply = text
						}
					}
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ChatResponse{
		Reply:     reply,
		Citations: citations,
	})
}
