#!/bin/bash
# Script to create Vectorize indexes for watchlist service
# Run these commands to create the indexes in each environment

echo "Creating Vectorize indexes for watchlist service..."
echo ""
echo "The bge-base-en-v1.5 model produces 768-dimensional vectors"
echo ""

# Create dev index
echo "Creating watchlist-dev index..."
wrangler vectorize create watchlist-dev \
  --dimensions=768 \
  --metric=cosine \
  --description="Watchlist semantic search index for dev environment"

# Create preview index
echo ""
echo "Creating watchlist-preview index..."
wrangler vectorize create watchlist-preview \
  --dimensions=768 \
  --metric=cosine \
  --description="Watchlist semantic search index for preview environment"

# Create prod index
echo ""
echo "Creating watchlist index (prod)..."
wrangler vectorize create watchlist \
  --dimensions=768 \
  --metric=cosine \
  --description="Watchlist semantic search index for production environment"

echo ""
echo "Done! Indexes created successfully."
