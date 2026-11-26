ALTER TABLE document_folders ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES document_folders(id) ON DELETE CASCADE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_id INT REFERENCES document_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_document_folders_parent ON document_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_documents_folder_id ON documents(folder_id);

-- Синхронизация существующих категорий документов в дерево папок (уровень корня)
INSERT INTO document_folders (name)
SELECT DISTINCT TRIM(category)
FROM documents
WHERE category IS NOT NULL AND TRIM(category) != ''
  AND NOT EXISTS (
    SELECT 1 FROM document_folders df
    WHERE LOWER(df.name) = LOWER(TRIM(documents.category)) AND df.parent_id IS NULL
  );

UPDATE documents d
SET folder_id = df.id
FROM document_folders df
WHERE d.folder_id IS NULL
  AND d.category IS NOT NULL
  AND LOWER(df.name) = LOWER(TRIM(d.category))
  AND df.parent_id IS NULL;
