-- Migration 004: Lightweight Full-Text Search, Semantic Vector Chunks and Persistent Status

ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_text TEXT DEFAULT '';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_tsv TSVECTOR;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS indexing_status VARCHAR(20) DEFAULT 'PENDING';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS indexing_error TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_content_tsv ON documents USING GIN(content_tsv);
CREATE INDEX IF NOT EXISTS idx_documents_indexing_status ON documents(indexing_status);

CREATE TABLE IF NOT EXISTS document_chunks (
  id SERIAL PRIMARY KEY,
  document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  tsv TSVECTOR,
  embedding REAL[] DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON document_chunks USING GIN(tsv);
