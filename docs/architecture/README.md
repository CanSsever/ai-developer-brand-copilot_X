# Architecture

## Core ownership model

`User` is the product-data ownership root. A `Project` belongs to exactly one `User` through a required UUID foreign key. Deleting a user cascades to their projects, and the ownership key is indexed for user-scoped project queries.

Each project persists a required IANA timezone identifier. Future onboarding will supply the browser-derived value; authentication and timezone capture are not implemented in Task 0.4. Database timestamps remain UTC.

## Prisma migrations

Migration files live in `apps/api/prisma/migrations`. Create development migrations with `pnpm db:migrate:dev -- --name <migration_name>`, apply committed migrations with `pnpm db:migrate:deploy`, and inspect state with `pnpm db:migrate:status`. Prisma CLI migration operations use the server-only direct database connection configured for the API.
