# Insurance Policy Platform

Modular monolith for importing insurance policy files, searching and aggregating policies, and delivering scheduled reminder messages. The API, queue worker, and CPU monitor are separate processes. MongoDB is the durable store. Redis and BullMQ carry background work only.

## Prerequisites

- Docker Desktop with Docker Compose v2
- Git
- Node.js 22 or newer, only if you want to run tests or the import command outside Docker

No host MongoDB or Redis install is required for the Compose workflow.

## One-command setup

From a fresh clone:

```bash
node scripts/compose-up.js
```

On Windows PowerShell:

```powershell
node scripts/compose-up.js
```

The script copies `.env.example` to `.env` only when `.env` is missing. An existing `.env` is left unchanged. It then runs `docker compose up --build`.

Manual equivalent:

```bash
cp .env.example .env
docker compose up --build
```

PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

## Ports

| Service | Port  | Purpose                                    |
| ------- | ----- | ------------------------------------------ |
| API     | 3000  | HTTP API and Swagger UI                    |
| MongoDB | 27017 | Database, persisted in volume `mongo_data` |
| Redis   | 6379  | BullMQ, persisted in volume `redis_data`   |

Swagger UI: [http://localhost:3000/api/docs/](http://localhost:3000/api/docs/)

Containers talk to each other with the Compose service names `mongodb` and `redis`. Compose overrides `MONGODB_URI` and `REDIS_URL` from `.env`, so a localhost value in `.env` does not break the containers.

## Processes

| Container | Command                           | Role                                                                                                   |
| --------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `api`     | `node src/server.js`              | HTTP. Non-root `app` user. Starts listening only after MongoDB and Redis connect.                      |
| `worker`  | `node src/workers/worker.main.js` | BullMQ consumers for imports and scheduled messages. Shares the upload volume with the API.            |
| `monitor` | `node src/monitor/main.js`        | Samples system CPU and may restart only `insurance-api`. Runs as root so it can use the Docker socket. |
| `mongodb` | MongoDB 7                         | Named volume `mongo_data`.                                                                             |
| `redis`   | Redis 7 with AOF                  | Named volume `redis_data`.                                                                             |

API and worker wait on MongoDB and Redis health checks, then retry their own clients before serving or consuming. SIGTERM closes the HTTP server, BullMQ workers, Redis, and Mongoose. The monitor stays up when the API container restarts.

Uploaded files live on the shared `upload_data` volume mounted at `/app/tmp/uploads` in both the API and the worker.

## Environment variables

Copy `.env.example`. Compose replaces the database URLs inside containers.

| Variable                                   | Default            | Meaning                                             |
| ------------------------------------------ | ------------------ | --------------------------------------------------- |
| `PORT` / `HOST`                            | `3000` / `0.0.0.0` | API bind address                                    |
| `MONGODB_URI`                              | localhost          | Mongo connection string                             |
| `REDIS_URL`                                | localhost          | Redis connection string                             |
| `MAX_UPLOAD_BYTES`                         | 26214400           | Upload limit, 25 MiB                                |
| `IMPORT_BATCH_SIZE`                        | 500                | Rows written per bulk batch                         |
| `IMPORT_QUEUE_CONCURRENCY`                 | 1                  | Parallel import jobs                                |
| `IMPORT_JOB_ATTEMPTS`                      | 3                  | BullMQ attempts                                     |
| `CPU_THRESHOLD_PERCENT`                    | 70                 | System-wide CPU percent that counts as high         |
| `CPU_SAMPLE_INTERVAL_MS`                   | 5000               | Time between samples                                |
| `CPU_CONSECUTIVE_SAMPLES`                  | 3                  | High samples required before a restart              |
| `CPU_RESTART_COOLDOWN_MS`                  | 60000              | Minimum time between restarts                       |
| `CPU_MAX_RESTARTS_PER_WINDOW`              | 3                  | Restart cap                                         |
| `CPU_RESTART_WINDOW_MS`                    | 600000             | Window for that cap                                 |
| `CPU_RESTART_ENABLED`                      | true               | Set `false` to log the decision and not call Docker |
| `API_CONTAINER_NAME`                       | `insurance-api`    | Container the monitor restarts                      |
| `SEARCH_MAX_LIMIT` / `AGGREGATE_MAX_LIMIT` | 100                | Page size cap                                       |
| `POLICIES_PER_USER_LIMIT`                  | 50                 | Policies returned per user on search                |

## API

Errors use one JSON shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [] } }
```

### Health

- `GET /health/live` returns 200 when the process is up.
- `GET /health/ready` returns 200 only when MongoDB and Redis both respond. Otherwise 503.

### Import

`POST /api/imports` with multipart field `file`. Accepts `.csv` and `.xlsx`. Returns `202` and a job id.

```bash
curl -F "file=@policies.csv" http://localhost:3000/api/imports
```

`GET /api/imports/:jobId` returns `queued`, `processing`, `completed`, or `failed`, plus `total`, `imported`, `skipped`, and `invalid`. Validation errors contain a row number, field, and code. They do not contain customer values.

### Policy search

`GET /api/policies/search?username=John&page=1&limit=20`

The source file has `firstname`, not a unique username. `username` is trimmed and matched with case-insensitive equality against `firstname`. The value is never compiled into a regular expression. Users who share a first name are returned as separate objects, each with their own policies. Address, phone, and date of birth are omitted. Agent, account, category, and carrier references are populated when present.

A search with no matches returns `200` and an empty `results` array.

### Policy aggregation

`GET /api/policies/aggregate?page=1&limit=20`

Groups `policies` by user id, joins `users`, and returns `userId`, `displayName`, and `policyCount`. A missing user is returned as `Unknown`. Results are ordered by count descending.

### Scheduled messages

```bash
curl -X POST http://localhost:3000/api/scheduled-messages \
  -H "content-type: application/json" \
  -d '{"message":"Policy renewal reminder","day":"2026-10-20","time":"10:30","timezone":"Asia/Kolkata"}'
```

`GET /api/scheduled-messages/:id` returns the stored message and status.

"Insert message at the scheduled time" means the text is stored immediately as `pending`, and at the scheduled instant the worker atomically moves that document to `executed` and sets `executedAt`. The worker does not run the message as code or as a shell command. `10:30` in `Asia/Kolkata` is `05:00` UTC. Times that do not exist in the zone, such as a daylight-saving gap, are rejected. Past times are rejected.

## CSV and XLSX columns

The first worksheet is imported. Required columns are `firstname`, `category_name`, `company_name`, and `policy_number`. Headers are matched case-insensitively, and spaces or hyphens are treated as underscores.

| Column                                                                           | Stored on                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------ |
| `agent`                                                                          | Agent, optional policy reference                 |
| `firstname`                                                                      | User display name and search key                 |
| `dob`, `address`, `phone`, `state`, `zip`, `email`, `gender`, `userType`, `city` | User. Not returned by search.                    |
| `account_name`                                                                   | Account for that user, optional policy reference |
| `category_name`                                                                  | LOB                                              |
| `company_name`                                                                   | Carrier                                          |
| `policy_number`                                                                  | Policy natural key                               |
| `policy_start_date`, `policy_end_date`                                           | Policy. End must be on or after start.           |
| `policy_type`, `premium_amount`, `producer`, `city`                              | Policy extras when present                       |

Dates accept ISO `YYYY-MM-DD`, `M/D/YYYY`, and Excel date cells. Empty rows are ignored.

## Deduplication

Repeated imports upsert. They do not create a second copy of the same business key.

| Entity             | Stable key                                        | Assumption                                                                          |
| ------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Agent              | Trimmed, lowercased agent name                    | The file has no agent id. The same name is one agent.                               |
| User               | Lowercased email when present and valid           | Email identifies a person across different first names.                             |
| User without email | SHA-256 of `firstname`, `dob`, `phone`, and `zip` | A row with none of dob, phone, and zip is invalid. First name alone is never a key. |
| Account            | User identity plus lowercased `account_name`      | The same account name for two users is two accounts.                                |
| LOB                | Lowercased `category_name`                        | Category names are shared reference data.                                           |
| Carrier            | Lowercased `company_name`                         | Company names are shared reference data.                                            |
| Policy             | `policy_number`                                   | A later import updates the existing policy.                                         |

Inside one file, the first row for a policy number is imported and later copies are `skipped`. Invalid rows increment `invalid` and are not written. An import is marked `completed` only after every accepted batch `bulkWrite` has finished. A crashed attempt leaves the file in place so BullMQ can retry the upserts. The temp file is removed after success or after the last failed attempt.

## Queues and worker threads

| Queue                | Worker                                                          | Payload                                           |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| `policy-import`      | Import worker, concurrency 1, 3 attempts, exponential backoff   | Import job id and stored filename                 |
| `scheduled-messages` | Schedule worker, concurrency 5, 3 attempts, exponential backoff | Scheduled message id, delayed until `scheduledAt` |

The BullMQ process owns job state, retries, and concurrency. The worker thread only parses and normalizes the file. It streams CSV with `csv-parse` and XLSX with the ExcelJS streaming reader, and it waits for the parent to acknowledge each batch before reading the next one. The parent writes the batch with `bulkWrite`. Mongoose is not used inside the thread.

MongoDB remains the source of truth for users, policies, import jobs, and scheduled messages. On worker startup, and every `SCHEDULE_RECOVERY_INTERVAL_MS`, pending messages that no longer have a live delayed job are enqueued again. A delivery claims the document with `findOneAndUpdate`. A second caller sees `executed` or loses the claim and does not write again. A BullMQ retry can take over a `processing` document left by a crashed attempt.

## CPU monitoring

The monitor process is a separate container. It does not run inside the API process, and an API restart does not stop it.

Metric: system-wide CPU percent, not the Node process.

1. On Linux, read the aggregate `cpu` line from `/proc/stat`. Idle includes `idle + iowait`. Percent is `(totalDelta - idleDelta) / totalDelta * 100`.
2. Where `/proc/stat` is unavailable, use the same delta across all cores from `os.cpus()`.

The first sample is a baseline and does not trigger a decision. A restart is requested only after `CPU_CONSECUTIVE_SAMPLES` readings at or above `CPU_THRESHOLD_PERCENT` (default 70). A cooldown and a maximum number of restarts per window then suppress further restarts. The monitor calls the Docker Engine API on the mounted socket:

`POST /v1.41/containers/insurance-api/restart`

That restarts the API container only. It does not restart Compose, MongoDB, Redis, the worker, or the monitor. If the socket is missing or Docker returns an error, the monitor logs the failure and keeps sampling. Set `CPU_RESTART_ENABLED=false` to exercise the threshold logic without restarting anything. Inside Docker Desktop, `/proc/stat` reflects the Linux VM rather than a cgroup limit.

## Local import command

This runs the same parser thread and upsert logic in the current process. It expects MongoDB from `.env` and does not delete the source file. The HTTP import path is the one that uses BullMQ.

```bash
npm run import -- --file C:\path\to\policies.csv
```

Do not commit customer files. `.gitignore` ignores `.env`, uploads, and spreadsheet files outside `tests/fixtures`.

## Tests and lint

```bash
npm test
npm run lint
npm run format:check
```

Tests use `mongodb-memory-server`, `redis-memory-server`, and synthetic rows. They do not read a customer file. CPU tests inject snapshots, so they do not need a hot machine. One integration file runs a real BullMQ import worker and a delayed scheduled-message job against that Redis.

## Troubleshooting

- `docker is not recognized` or `Docker was not found on PATH`: Docker Desktop is not installed or its terminal was opened before install. Install it, start it, open a new terminal, and run `node scripts/compose-up.js` again.
- API container restarts in a loop: check `docker logs` for the monitor. Raise the threshold or set `CPU_RESTART_ENABLED=false` while debugging.
- Import stays `queued`: the worker container is down, or the upload volume is not mounted on both API and worker.
- `GET /health/ready` is 503: MongoDB or Redis has not passed its health check yet.
- Port 27017 or 6379 already in use: stop the local database or change the published port in `docker-compose.yml`. The internal hostnames stay `mongodb` and `redis`.
- XLSX rejected: the file must be a real `.xlsx` workbook (ZIP header), not a renamed `.xls` file.

## Security and privacy

- No secrets belong in git. `.env.example` has local defaults only.
- Helmet sets security headers. JSON bodies and uploads are size-limited.
- Logs redact email, phone, address, date of birth, and authorization headers.
- Import errors store codes, not customer cell values.
- Search does not return address, phone, or date of birth.
- Scheduled message text is stored and later marked delivered. It is never evaluated.
- The monitor container is the only one with the Docker socket, and it is limited by application code to restarting `insurance-api`. That socket is still a privileged host channel. Do not expose the monitor or the database ports on an untrusted network.
