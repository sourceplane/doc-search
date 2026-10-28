-- The embedding column and the search function, sized for Workers AI's
-- embedding model.
--
-- Upstream embedded with OpenAI's text-embedding-ada-002, 1536 dimensions,
-- and 010 (its init migration, verbatim) created the column and
-- match_page_sections() at that size. The app embeds with Workers AI's
-- @cf/baai/bge-base-en-v1.5 through the Worker's AI binding
-- (apps/web/lib/ai/models.ts), 768 dimensions, so both are resized here.
--
-- FIRST, the guard. A vector from another model cannot be resized, and would
-- be meaningless beside Workers AI's if it could: two models do not share a
-- space. If any row holds one, stop and say what to do, changing nothing —
-- the guard runs before the ALTER. On a new environment the table is empty.
DO $$
DECLARE
  foreign_vectors bigint;
BEGIN
  SELECT count(*) INTO foreign_vectors FROM nods_page_section WHERE vector_dims(embedding) <> 768;
  IF foreign_vectors > 0 THEN
    RAISE EXCEPTION 'nods_page_section holds % vector(s) from another embedding model: delete them (DELETE FROM nods_page_section WHERE vector_dims(embedding) <> 768; UPDATE nods_page SET checksum = NULL) and POST /api/embeddings, so Workers AI embeds the docs again', foreign_vectors;
  END IF;
END
$$;

ALTER TABLE nods_page_section ALTER COLUMN embedding SET DATA TYPE vector(768);

-- The search function, at the new size, with two changes from upstream's:
--
--   - similarity is COSINE (1 - the <=> distance), not the negated inner
--     product (<#>). Upstream used the inner product because OpenAI's vectors
--     are normalized to length 1, where the two agree; this keeps the measure
--     right whatever the model returns.
--   - it returns each section's token_count, so the app builds the answer's
--     context from the counts stored at indexing instead of running a
--     tokenizer on every search.
--
-- The return type changes, so the old function is dropped first.
DROP FUNCTION IF EXISTS match_page_sections(vector, float, int, int);

create or replace function match_page_sections(embedding vector(768), match_threshold float, match_count int, min_content_length int)
returns table (id bigint, page_id bigint, slug text, heading text, content text, token_count int, similarity float)
language plpgsql
as $$
#variable_conflict use_variable
begin
  return query
  select
    nods_page_section.id,
    nods_page_section.page_id,
    nods_page_section.slug,
    nods_page_section.heading,
    nods_page_section.content,
    nods_page_section.token_count,
    1 - (nods_page_section.embedding <=> embedding) as similarity
  from nods_page_section

  -- We only care about sections that have a useful amount of content
  where length(nods_page_section.content) >= min_content_length

  and 1 - (nods_page_section.embedding <=> embedding) > match_threshold

  order by nods_page_section.embedding <=> embedding

  limit match_count;
end;
$$;
