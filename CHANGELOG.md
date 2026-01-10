# [1.2.0-rc.2](https://github.com/janovix/watchlist-svc/compare/v1.2.0-rc.1...v1.2.0-rc.2) (2026-01-10)


### Features

* **auth:** enhance authMiddleware for test environment support ([275b450](https://github.com/janovix/watchlist-svc/commit/275b450fef84cd9c1ef8e8b462223fa36dd64000))

# [1.2.0-rc.1](https://github.com/janovix/watchlist-svc/compare/v1.1.0...v1.2.0-rc.1) (2026-01-10)


### Bug Fixes

* **auth:** add AUTH_SERVICE_URL back for JWKS endpoint URL construction ([d3c192c](https://github.com/janovix/watchlist-svc/commit/d3c192c8fce1106a698203ff42deb1fa50433acb))


### Features

* Add CORS_ALLOWED_DOMAIN to wrangler configs and update mocks ([340e560](https://github.com/janovix/watchlist-svc/commit/340e5605403b29b003be6bb78a51691f20df7f59))
* Add CSV streaming and update queue names ([ac81d21](https://github.com/janovix/watchlist-svc/commit/ac81d218062cf46b6408933bddd079198fb8279b))
* Add Grok API as a fallback for watchlist search ([e04f054](https://github.com/janovix/watchlist-svc/commit/e04f054b4589725dd9171640c0c896c722abede4))
* Add Mexico PEP list to GrokService prompt ([02c3b54](https://github.com/janovix/watchlist-svc/commit/02c3b5434ad0c41fe91b953a9e18a8747d3a99a9))
* Add PEP search endpoint and CORS configuration ([0f937fb](https://github.com/janovix/watchlist-svc/commit/0f937fba95ff5a4ba2440cc41829b0cac8108965))
* Add PEP search endpoint using Grok API ([88eeb69](https://github.com/janovix/watchlist-svc/commit/88eeb699ecac0ad9ffced9e408da481a24146508))
* Add unit tests for GrokService and mock Vectorize ([9adb28a](https://github.com/janovix/watchlist-svc/commit/9adb28a7d856f4060e472e649a2f13e9f45fc4dc))
* Add Vectorize search as PEP lookup fallback ([4d2f420](https://github.com/janovix/watchlist-svc/commit/4d2f42064c59519cd8196ac6e93b1ffcb0ea6680))
* **auth:** add JWT authentication middleware using service binding ([0ce7798](https://github.com/janovix/watchlist-svc/commit/0ce7798ea2431a01b73918c773dacb1c308be1cd))
* Configure CORS for janovix.workers.dev subdomains ([655a92a](https://github.com/janovix/watchlist-svc/commit/655a92a5943dccc0e89c98a11527af2ec764ea00))
* Implement background CSV ingestion via queues ([a21e2b5](https://github.com/janovix/watchlist-svc/commit/a21e2b51df84058daee4973a32842b74cf8be8b8))
* Set pnpm as package manager ([96ec1c3](https://github.com/janovix/watchlist-svc/commit/96ec1c3cc6adce10bee2ab7fc65494379fcc1525))
* Use grok-3 model for AI requests ([91ccad6](https://github.com/janovix/watchlist-svc/commit/91ccad61fee519e4d39e23eccca06be3c6f99ac0))
* Use grok-4-fast-non-reasoning model ([c8b30af](https://github.com/janovix/watchlist-svc/commit/c8b30afa1f4d74e6a68d12f460decaf13050d18d))

# [1.1.0-rc.9](https://github.com/janovix/watchlist-svc/compare/v1.1.0-rc.8...v1.1.0-rc.9) (2025-12-19)


### Bug Fixes

* **auth:** add AUTH_SERVICE_URL back for JWKS endpoint URL construction ([d3c192c](https://github.com/janovix/watchlist-svc/commit/d3c192c8fce1106a698203ff42deb1fa50433acb))

# [1.1.0-rc.8](https://github.com/janovix/watchlist-svc/compare/v1.1.0-rc.7...v1.1.0-rc.8) (2025-12-19)


### Features

* **auth:** add JWT authentication middleware using service binding ([0ce7798](https://github.com/janovix/watchlist-svc/commit/0ce7798ea2431a01b73918c773dacb1c308be1cd))

# [1.1.0-rc.7](https://github.com/janovix/watchlist-svc/compare/v1.1.0-rc.6...v1.1.0-rc.7) (2025-12-19)


### Features

* Add Mexico PEP list to GrokService prompt ([02c3b54](https://github.com/janovix/watchlist-svc/commit/02c3b5434ad0c41fe91b953a9e18a8747d3a99a9))

# [1.1.0-rc.6](https://github.com/janovix/watchlist-svc/compare/v1.1.0-rc.5...v1.1.0-rc.6) (2025-12-18)


### Features

* Add CORS_ALLOWED_DOMAIN to wrangler configs and update mocks ([340e560](https://github.com/janovix/watchlist-svc/commit/340e5605403b29b003be6bb78a51691f20df7f59))
* Add PEP search endpoint and CORS configuration ([0f937fb](https://github.com/janovix/watchlist-svc/commit/0f937fba95ff5a4ba2440cc41829b0cac8108965))
* Add Vectorize search as PEP lookup fallback ([4d2f420](https://github.com/janovix/watchlist-svc/commit/4d2f42064c59519cd8196ac6e93b1ffcb0ea6680))
* Configure CORS for janovix.workers.dev subdomains ([655a92a](https://github.com/janovix/watchlist-svc/commit/655a92a5943dccc0e89c98a11527af2ec764ea00))

# [1.1.0-rc.5](https://github.com/janovix/watchlist-svc/compare/v1.1.0-rc.4...v1.1.0-rc.5) (2025-12-18)


### Features

* Add PEP search endpoint using Grok API ([88eeb69](https://github.com/janovix/watchlist-svc/commit/88eeb699ecac0ad9ffced9e408da481a24146508))
* Use grok-3 model for AI requests ([91ccad6](https://github.com/janovix/watchlist-svc/commit/91ccad61fee519e4d39e23eccca06be3c6f99ac0))
* Use grok-4-fast-non-reasoning model ([c8b30af](https://github.com/janovix/watchlist-svc/commit/c8b30afa1f4d74e6a68d12f460decaf13050d18d))

# [1.1.0-rc.4](https://github.com/janovix/watchlist-svc/compare/v1.1.0-rc.3...v1.1.0-rc.4) (2025-12-17)


### Features

* Set pnpm as package manager ([96ec1c3](https://github.com/janovix/watchlist-svc/commit/96ec1c3cc6adce10bee2ab7fc65494379fcc1525))

# [1.1.0-rc.3](https://github.com/janovix/watchlist-svc/compare/v1.1.0-rc.2...v1.1.0-rc.3) (2025-12-17)


### Features

* Add Grok API as a fallback for watchlist search ([e04f054](https://github.com/janovix/watchlist-svc/commit/e04f054b4589725dd9171640c0c896c722abede4))
* Add unit tests for GrokService and mock Vectorize ([9adb28a](https://github.com/janovix/watchlist-svc/commit/9adb28a7d856f4060e472e649a2f13e9f45fc4dc))

# [1.1.0-rc.2](https://github.com/janovix/watchlist-svc/compare/v1.1.0-rc.1...v1.1.0-rc.2) (2025-12-16)


### Features

* Add CSV streaming and update queue names ([ac81d21](https://github.com/janovix/watchlist-svc/commit/ac81d218062cf46b6408933bddd079198fb8279b))
* Implement background CSV ingestion via queues ([a21e2b5](https://github.com/janovix/watchlist-svc/commit/a21e2b51df84058daee4973a32842b74cf8be8b8))
* Add AI binding to wrangler config ([e6e98de](https://github.com/janovix/watchlist-svc/commit/e6e98debeb761fc70eba2695789db5e16506cac4))
* Add runId description and example to schema ([64e1ec6](https://github.com/janovix/watchlist-svc/commit/64e1ec63e75ced53a81f913f58950aabac5751fb))
* Configure Vitest for local development and CI ([1cf1589](https://github.com/janovix/watchlist-svc/commit/1cf1589b2fd2c19d444b46fb33a185bbf245db0f))
* Improve AI binding error handling ([f5b7dcc](https://github.com/janovix/watchlist-svc/commit/f5b7dccda1df202a25f6fcde9e010bab554b8a28))
* Improve error reporting for ingest failures ([87c32ec](https://github.com/janovix/watchlist-svc/commit/87c32ec09c4720e690d5b110da532105a083e2ce))

# [1.1.0-rc.1](https://github.com/janovix/watchlist-svc/compare/v1.0.0...v1.1.0-rc.1) (2025-12-16)


### Features

* Add AI binding to wrangler config ([e6e98de](https://github.com/janovix/watchlist-svc/commit/e6e98debeb761fc70eba2695789db5e16506cac4))
* Add runId description and example to schema ([64e1ec6](https://github.com/janovix/watchlist-svc/commit/64e1ec63e75ced53a81f913f58950aabac5751fb))
* Configure Vitest for local development and CI ([1cf1589](https://github.com/janovix/watchlist-svc/commit/1cf1589b2fd2c19d444b46fb33a185bbf245db0f))
* Improve AI binding error handling ([f5b7dcc](https://github.com/janovix/watchlist-svc/commit/f5b7dccda1df202a25f6fcde9e010bab554b8a28))
* Improve error reporting for ingest failures ([87c32ec](https://github.com/janovix/watchlist-svc/commit/87c32ec09c4720e690d5b110da532105a083e2ce))

# 1.0.0 (2025-12-15)


### Bug Fixes

* add Prisma packages to dependencies ([19486fd](https://github.com/janovix/watchlist-svc/commit/19486fd7693adba444ab63fd4fb718c1d4a79f7e))
* configure Prisma output path for Workers build ([d4d0b6a](https://github.com/janovix/watchlist-svc/commit/d4d0b6a7387711e373e26b9a046534534f71d81c))
* ensure Prisma generates before build and adjust coverage threshold ([a836760](https://github.com/janovix/watchlist-svc/commit/a83676043fc9868d766fec766aa0801ace0b9765))
* resolve typecheck and vitest-coverage CI issues ([3a1c89f](https://github.com/janovix/watchlist-svc/commit/3a1c89f12fed4185188847540c8bc3999474a0de))
* use pnpm exec for prisma generate in CI ([ff0be61](https://github.com/janovix/watchlist-svc/commit/ff0be613cffcd7474ae49fb11d599954539fce19))

### Features

* Add prisma client and adapter dependencies ([fa75719](https://github.com/janovix/watchlist-svc/commit/fa757198d7c193242c3250aa2bb0b50f6db16fbf))

# [1.0.0-rc.3](https://github.com/janovix/watchlist-svc/compare/v1.0.0-rc.2...v1.0.0-rc.3) (2025-12-16)


### Features

* Add AI binding to wrangler config ([e6e98de](https://github.com/janovix/watchlist-svc/commit/e6e98debeb761fc70eba2695789db5e16506cac4))
* Configure Vitest for local development and CI ([1cf1589](https://github.com/janovix/watchlist-svc/commit/1cf1589b2fd2c19d444b46fb33a185bbf245db0f))
* Improve AI binding error handling ([f5b7dcc](https://github.com/janovix/watchlist-svc/commit/f5b7dccda1df202a25f6fcde9e010bab554b8a28))
* Improve error reporting for ingest failures ([87c32ec](https://github.com/janovix/watchlist-svc/commit/87c32ec09c4720e690d5b110da532105a083e2ce))

# [1.0.0-rc.2](https://github.com/janovix/watchlist-svc/compare/v1.0.0-rc.1...v1.0.0-rc.2) (2025-12-16)


### Features

* Add runId description and example to schema ([64e1ec6](https://github.com/janovix/watchlist-svc/commit/64e1ec63e75ced53a81f913f58950aabac5751fb))

# 1.0.0-rc.1 (2025-12-15)


### Bug Fixes

* add Prisma packages to dependencies ([19486fd](https://github.com/janovix/watchlist-svc/commit/19486fd7693adba444ab63fd4fb718c1d4a79f7e))
* configure Prisma output path for Workers build ([d4d0b6a](https://github.com/janovix/watchlist-svc/commit/d4d0b6a7387711e373e26b9a046534534f71d81c))
* ensure Prisma generates before build and adjust coverage threshold ([a836760](https://github.com/janovix/watchlist-svc/commit/a83676043fc9868d766fec766aa0801ace0b9765))
* resolve typecheck and vitest-coverage CI issues ([3a1c89f](https://github.com/janovix/watchlist-svc/commit/3a1c89f12fed4185188847540c8bc3999474a0de))
* use pnpm exec for prisma generate in CI ([ff0be61](https://github.com/janovix/watchlist-svc/commit/ff0be613cffcd7474ae49fb11d599954539fce19))


### Features

* Add prisma client and adapter dependencies ([fa75719](https://github.com/janovix/watchlist-svc/commit/fa757198d7c193242c3250aa2bb0b50f6db16fbf))

# [1.1.0](https://github.com/algtools/backend-template/compare/v1.0.0...v1.1.0) (2025-12-14)


### Features

* Add TASKS_KV namespace to wrangler configs ([dc106de](https://github.com/algtools/backend-template/commit/dc106debc6d30662d681ddd765723f41b3505d42))
* enhance API with metadata and health check endpoints ([dc9a501](https://github.com/algtools/backend-template/commit/dc9a501e5947d2231cbb26dc84330093cb108369))
* Implement KV caching for tasks API ([f1d1262](https://github.com/algtools/backend-template/commit/f1d1262446fe920cac2e1b65703f5aab8af9ee50))

# [1.1.0-rc.1](https://github.com/algtools/backend-template/compare/v1.0.0...v1.1.0-rc.1) (2025-12-14)


### Features

* Add TASKS_KV namespace to wrangler configs ([dc106de](https://github.com/algtools/backend-template/commit/dc106debc6d30662d681ddd765723f41b3505d42))
* enhance API with metadata and health check endpoints ([dc9a501](https://github.com/algtools/backend-template/commit/dc9a501e5947d2231cbb26dc84330093cb108369))
* Implement KV caching for tasks API ([f1d1262](https://github.com/algtools/backend-template/commit/f1d1262446fe920cac2e1b65703f5aab8af9ee50))

# 1.0.0 (2025-12-13)

### Features

* Add TASKS_KV namespace to wrangler configs ([dc106de](https://github.com/algtools/backend-template/commit/dc106debc6d30662d681ddd765723f41b3505d42))
* Implement KV caching for tasks API ([f1d1262](https://github.com/algtools/backend-template/commit/f1d1262446fe920cac2e1b65703f5aab8af9ee50))

# [1.0.0-rc.2](https://github.com/algtools/backend-template/compare/v1.0.0-rc.1...v1.0.0-rc.2) (2025-12-13)


### Features

* enhance API with metadata and health check endpoints ([dc9a501](https://github.com/algtools/backend-template/commit/dc9a501e5947d2231cbb26dc84330093cb108369))
* Add linting and formatting dependencies ([ef9d4c8](https://github.com/algtools/backend-template/commit/ef9d4c8ca32276f4bd49f5d46ba9723d0f06f478))

# 1.0.0-rc.1 (2025-12-13)


### Features

* Add linting and formatting dependencies ([ef9d4c8](https://github.com/algtools/backend-template/commit/ef9d4c8ca32276f4bd49f5d46ba9723d0f06f478))
