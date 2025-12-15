# Pre-Completion Checklist

## Mandatory Pre-Completion Checklist

**CRITICAL**: Before marking any task as complete, you MUST:

### 1. Run All Quality Checks

- ✅ Run `pnpm run lint` - ensure all linting checks pass (green)
- ✅ Run `pnpm run format:check` - ensure all formatting checks pass (green)
- ✅ Run `pnpm run typecheck` - ensure all type checks pass (green)
- ✅ Run `pnpm run test` - ensure all tests pass (green)

### 2. Update OpenAPI Schema

- ✅ Run `pnpm run schema` to extract and update the OpenAPI schema
- ✅ Verify that `openapi.json` reflects all current endpoints and changes
- ✅ Ensure the OpenAPI schema is accurate and up-to-date with your code changes

### 3. Test Scalar API Documentation

- ✅ Verify that Scalar API documentation is accessible and renders correctly
- ✅ Test that `/docs` endpoint serves the Scalar HTML correctly
- ✅ Test that `/openapi.json` endpoint returns valid OpenAPI schema
- ✅ Ensure all endpoints are properly documented in the Scalar interface

### 4. Commit Standards (Background Agents Only)

- ✅ Use conventional commits format (see commitlint.config.cjs)
- ✅ Commit message must follow commitlint config (max 200 characters)
- ✅ Include Linear issue reference in commit message if available in cloud agent context
- ✅ Format: `type(scope): description [Linear: ISSUE-ID]` or `type(scope): description (fixes ISSUE-ID)`

## Workflow Summary

When completing any task:

1. ✅ Implement/update code
2. ✅ Run `pnpm run lint` and fix any issues
3. ✅ Run `pnpm run format:check` and fix formatting if needed
4. ✅ Run `pnpm run typecheck` and fix any type errors
5. ✅ Run `pnpm run test` and ensure all tests pass
6. ✅ Run `pnpm run schema` to update OpenAPI schema
7. ✅ Verify Scalar documentation at `/docs` endpoint
8. ✅ Verify OpenAPI schema at `/openapi.json` endpoint
9. ✅ (Background agents only) Create conventional commit with Linear reference if available

**DO NOT mark work as complete until ALL checks are green and OpenAPI/Scalar are verified.**
