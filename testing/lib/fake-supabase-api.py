#!/usr/bin/env python3
"""A stand-in for the ONE Supabase Management API endpoint the migration
runner uses, over a local Postgres.

    fake-supabase-api.py <port> <postgres-url> [--ref <project-ref>]

packages/db's runner applies migrations through
`POST /v1/projects/<ref>/database/query` with `{"query": "<sql>"}` and reads
back the rows of the last statement as a JSON array; an error is a non-2xx
answer whose JSON `message` carries Postgres's own text (the runner treats
"does not exist" on its ledger as a first run). This serves exactly that, by
handing the SQL to `psql`, so the e2e can run the runner's real `apply` —
checksums, ledger, idempotent re-run — against the database the Worker then
reads. Only the bearer token's presence is checked; nothing else of the API
exists here.
"""
import http.server
import json
import re
import subprocess
import sys

PORT = int(sys.argv[1])
DB = sys.argv[2]
REF = sys.argv[sys.argv.index("--ref") + 1] if "--ref" in sys.argv else None
ROUTE = re.compile(r"^/v1/projects/([a-z0-9]+)/database/query$")


def psql(sql: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["psql", DB, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
        input=sql, capture_output=True, text=True,
    )


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quiet: the e2e prints what matters
        pass

    def answer(self, status: int, body) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        m = ROUTE.match(self.path)
        if not m or (REF and m.group(1) != REF):
            return self.answer(404, {"message": f"no such endpoint {self.path}"})
        if not (self.headers.get("authorization") or "").startswith("Bearer "):
            return self.answer(401, {"message": "missing bearer token"})
        query = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)))["query"]
        # A read returns its rows; anything else runs as written and returns
        # none, as the real endpoint does for DDL.
        if re.match(r"^\s*select\b", query, re.I):
            run = psql(f"select coalesce(json_agg(t), '[]'::json) from ({query.rstrip().rstrip(';')}) t;")
        else:
            run = psql(query)
        if run.returncode != 0:
            return self.answer(400, {"message": run.stderr.strip()})
        out = run.stdout.strip()
        return self.answer(201, json.loads(out) if out.startswith("[") else [])


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
