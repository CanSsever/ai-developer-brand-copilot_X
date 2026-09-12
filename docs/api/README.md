# API

The current operational health surface is:

- `GET /health` — application health
- `GET /health/db` — PostgreSQL connectivity health

The database health response reports only whether connectivity succeeded. It does not return credentials, connection strings, host information, or other sensitive connection metadata.
