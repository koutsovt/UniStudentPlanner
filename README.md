# UniStudent Planner

A proof-of-concept degree-planning and study-agent app for university students. Plan your subjects across teaching periods, track assessments and progress, manage your weekly timetable, set reminders, and chat with an LLM-backed study agent that has context on your plan.

Built around a single seeded student (`Alex Chen`, Bachelor of Computer Science) for demo purposes.

## Tech stack

- **Backend:** [Fastify](https://fastify.dev/) on Node 20+
- **Database:** SQLite via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)
- **LLM:** [OpenRouter](https://openrouter.ai/) (default model: `z-ai/glm-4.7`)
- **Frontend:** Static HTML + vanilla ES modules served by Fastify

## Features

- **Overview** — credit-point rollup, current teaching period, upcoming deadlines
- **Planner** — add/remove subjects per teaching period, prerequisite and credit-point validation
- **Timetable** — weekly view with swap-to-alternate session support
- **Assessments** — CRUD assessments with forecasted grade per subject
- **Progress** — course completion tracking against the BCS structure
- **Reminders** — timed reminders with `.ics` calendar export
- **Facts** — persistent notes the agent can reference
- **Agent** — multi-thread LLM chat with tool access to the student's plan, timetable, and facts
- **Nudges** — inline prompts for missing prerequisites, assessment gaps, etc.

## Running locally

```bash
npm install
npm run seed    # builds db/data.sqlite from schema.sql + seed data
npm run dev     # starts on http://localhost:3000 with --watch
```

Production-style start:

```bash
npm start       # re-seeds the DB, then starts the server
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `OPENROUTER_API_KEY` | *(unset)* | Enables the study agent. Without it, LLM features return an error. |
| `UNISTUDENT_LLM_MODEL` | `z-ai/glm-4.7` | OpenRouter model slug |
| `UNISTUDENT_DEMO` | *(unset)* | Set to `1` to expose `POST /api/demo/reset` (clears + reseeds the DB at runtime) |

## Project layout

```
server.js          Fastify app + all API routes
db/
  schema.sql       Table definitions (students, subjects, plan entries, timetable, assessments, reminders, threads, facts, nudges)
  seed.js          Reseed script — wipes and rebuilds data.sqlite with a demo student
  data.sqlite      Generated; gitignored
ui/
  *.html           One page per feature (index, planner, timetable, progress, reminders, facts, agent, settings)
  assets/          Shared JS modules and stylesheet
```

## Deploying on Railway

1. Create a new Railway project → **Deploy from GitHub repo** → pick this repo
2. Set `OPENROUTER_API_KEY` in the service's Variables tab
3. Railway auto-detects Node (via nixpacks) and runs `npm install` + `npm start`
4. Generate a public domain under **Settings → Networking**

The `start` script reseeds the DB on every boot — Railway containers don't persist `db/data.sqlite` between deploys, so runtime-written data (new reminders, chat messages, etc.) resets on redeploy. For persistent data, mount a Railway volume at `/app/db` and change `start` back to `node server.js`.

## API

All endpoints are under `/api/*`. See `server.js` for the full list — the main groups:

- `/api/student`, `/api/dashboard`, `/api/progress`
- `/api/planner`, `/api/planner/validate`
- `/api/timetable`, `/api/timetable/swap`
- `/api/assessments`, `/api/assessments/forecast/:subject_code`
- `/api/reminders`, `/api/calendar.ics`
- `/api/agent/threads`, `/api/agent/message`
- `/api/facts`
- `/api/nudges`
- `/api/demo/reset` *(only when `UNISTUDENT_DEMO=1`)*

## License

Unlicensed proof-of-concept.
