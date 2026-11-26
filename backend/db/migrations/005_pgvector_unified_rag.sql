-- Migration 005: pgvector HNSW + pg_trgm + Unified Knowledge Base (documents, project_materials, mail_attachments)

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Indexing status columns for project_materials
ALTER TABLE project_materials ADD COLUMN IF NOT EXISTS content_text TEXT DEFAULT '';
ALTER TABLE project_materials ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE project_materials ADD COLUMN IF NOT EXISTS indexing_status VARCHAR(20) DEFAULT 'PENDING';
ALTER TABLE project_materials ADD COLUMN IF NOT EXISTS indexing_error TEXT;
CREATE INDEX IF NOT EXISTS idx_materials_indexing_status ON project_materials(indexing_status);

-- Indexing status columns for mail_attachments
ALTER TABLE mail_attachments ADD COLUMN IF NOT EXISTS content_text TEXT DEFAULT '';
ALTER TABLE mail_attachments ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE mail_attachments ADD COLUMN IF NOT EXISTS indexing_status VARCHAR(20) DEFAULT 'PENDING';
ALTER TABLE mail_attachments ADD COLUMN IF NOT EXISTS indexing_error TEXT;
CREATE INDEX IF NOT EXISTS idx_mail_att_indexing_status ON mail_attachments(indexing_status);

-- Unified polymorphic chunks table for Hybrid RAG (documents + project_materials + mail_attachments)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id SERIAL PRIMARY KEY,
  source_type VARCHAR(30) NOT NULL, -- 'document' | 'project_material' | 'mail_attachment'
  source_id INT NOT NULL,
  chunk_index INT NOT NULL,
  title VARCHAR(500) NOT NULL DEFAULT '',
  section_label VARCHAR(255) DEFAULT '',
  content TEXT NOT NULL,
  contextual_content TEXT NOT NULL,
  tsv TSVECTOR,
  embedding vector(384),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_type, source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_kc_source ON knowledge_chunks(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_kc_source_type ON knowledge_chunks(source_type);
CREATE INDEX IF NOT EXISTS idx_kc_tsv ON knowledge_chunks USING GIN(tsv);
CREATE INDEX IF NOT EXISTS idx_kc_content_trgm ON knowledge_chunks USING GIN(content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_kc_title_trgm ON knowledge_chunks USING GIN(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_kc_embedding_hnsw ON knowledge_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Trigram indexes on source titles for typo-tolerant & exact-code search
CREATE INDEX IF NOT EXISTS idx_documents_title_trgm ON documents USING GIN(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_materials_title_trgm ON project_materials USING GIN(title gin_trgm_ops);

-- Автоматическая очистка полиморфных чанков при удалении источника
CREATE OR REPLACE FUNCTION cleanup_knowledge_chunks_fn() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM knowledge_chunks WHERE source_type = TG_ARGV[0] AND source_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cleanup_kc_documents ON documents;
CREATE TRIGGER trg_cleanup_kc_documents AFTER DELETE ON documents
FOR EACH ROW EXECUTE FUNCTION cleanup_knowledge_chunks_fn('document');

DROP TRIGGER IF EXISTS trg_cleanup_kc_materials ON project_materials;
CREATE TRIGGER trg_cleanup_kc_materials AFTER DELETE ON project_materials
FOR EACH ROW EXECUTE FUNCTION cleanup_knowledge_chunks_fn('project_material');

DROP TRIGGER IF EXISTS trg_cleanup_kc_mail_att ON mail_attachments;
CREATE TRIGGER trg_cleanup_kc_mail_att AFTER DELETE ON mail_attachments
FOR EACH ROW EXECUTE FUNCTION cleanup_knowledge_chunks_fn('mail_attachment');
