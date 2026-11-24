CREATE INDEX IF NOT EXISTS file_versions_file_id_idx ON file_versions(file_id);
CREATE INDEX IF NOT EXISTS file_versions_blob_id_idx ON file_versions(blob_id);
CREATE INDEX IF NOT EXISTS units_version_id_idx ON units(version_id);
CREATE INDEX IF NOT EXISTS files_owner_idx ON files(owner_type,owner_id);
CREATE INDEX IF NOT EXISTS lineage_edges_from_idx ON lineage_edges(from_version_id);
CREATE INDEX IF NOT EXISTS lineage_edges_to_idx ON lineage_edges(to_version_id);
CREATE INDEX IF NOT EXISTS near_duplicate_links_user_idx ON near_duplicate_links(user_id);
