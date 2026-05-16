-- Link SearchQuery to AML client / beneficial_controller for history and cross-service traceability
ALTER TABLE "search_query" ADD COLUMN "entity_id" TEXT;
ALTER TABLE "search_query" ADD COLUMN "entity_kind" TEXT;

CREATE INDEX "idx_search_query_org_entity_created" ON "search_query" ("organization_id", "entity_id", "created_at" DESC);
