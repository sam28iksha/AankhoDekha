"""One-time SQLite -> Postgres data migration for this machine's aankhodekha.db.
Run inside the backend container (has asyncpg + the mounted data/ volume):
    docker compose exec backend python scripts/migrate_to_postgres.py
"""
import asyncio
import sqlite3
from datetime import datetime, timezone

import asyncpg

SQLITE_PATH = "/app/data/aankhodekha.db"
PG_DSN = "postgresql://nagarnetra:nagarnetra_pass@db:5432/nagarnetra"


def parse_ts(s: str | None):
    if not s:
        return None
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


async def main():
    sconn = sqlite3.connect(SQLITE_PATH)
    sconn.row_factory = sqlite3.Row
    pconn = await asyncpg.connect(PG_DSN)

    # ── users: wipe the auto-seeded bootstrap admin, insert the real rows ──
    rows = sconn.execute(
        "SELECT id, username, password_hash, role, full_name, is_active, created_at FROM users"
    ).fetchall()
    await pconn.execute("DELETE FROM users")
    for r in rows:
        await pconn.execute(
            "INSERT INTO users (id, username, password_hash, role, full_name, is_active, created_at) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7)",
            r["id"], r["username"], r["password_hash"], r["role"], r["full_name"],
            bool(r["is_active"]), parse_ts(r["created_at"]),
        )
    if rows:
        await pconn.execute(
            "SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))"
        )
    print(f"users: migrated {len(rows)}")

    # ── plate_events ──
    rows = sconn.execute(
        "SELECT id, vehicle_id, vehicle_type, color, plate_number, camera_id, "
        "timestamp, confidence, frame_snapshot_path FROM plate_events"
    ).fetchall()
    for r in rows:
        await pconn.execute(
            "INSERT INTO plate_events (id, vehicle_id, vehicle_type, color, plate_number, "
            "camera_id, timestamp, confidence, frame_snapshot_path) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            r["id"], r["vehicle_id"], r["vehicle_type"], r["color"], r["plate_number"],
            r["camera_id"], parse_ts(r["timestamp"]), r["confidence"], r["frame_snapshot_path"],
        )
    if rows:
        await pconn.execute(
            "SELECT setval('plate_events_id_seq', (SELECT MAX(id) FROM plate_events))"
        )
    print(f"plate_events: migrated {len(rows)}")

    # ── blacklist ──
    rows = sconn.execute("SELECT plate_number, reason, added_at FROM blacklist").fetchall()
    for r in rows:
        await pconn.execute(
            "INSERT INTO blacklist (plate_number, reason, added_at) VALUES ($1,$2,$3)",
            r["plate_number"], r["reason"], parse_ts(r["added_at"]),
        )
    print(f"blacklist: migrated {len(rows)}")

    # ── alerts ──
    rows = sconn.execute(
        "SELECT id, plate_number, camera_id, timestamp, alert_type, resolved, details, source "
        "FROM alerts"
    ).fetchall()
    for r in rows:
        await pconn.execute(
            "INSERT INTO alerts (id, plate_number, camera_id, timestamp, alert_type, resolved, details, source) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            r["id"], r["plate_number"], r["camera_id"], parse_ts(r["timestamp"]),
            r["alert_type"], bool(r["resolved"]), r["details"], r["source"],
        )
    if rows:
        await pconn.execute("SELECT setval('alerts_id_seq', (SELECT MAX(id) FROM alerts))")
    print(f"alerts: migrated {len(rows)}")

    # ── audit_log ──
    rows = sconn.execute(
        "SELECT id, user_id, username, action, target, details, timestamp FROM audit_log"
    ).fetchall()
    for r in rows:
        await pconn.execute(
            "INSERT INTO audit_log (id, user_id, username, action, target, details, timestamp) "
            "VALUES ($1,$2,$3,$4,$5,$6,$7)",
            r["id"], r["user_id"], r["username"], r["action"], r["target"],
            r["details"], parse_ts(r["timestamp"]),
        )
    if rows:
        await pconn.execute("SELECT setval('audit_log_id_seq', (SELECT MAX(id) FROM audit_log))")
    print(f"audit_log: migrated {len(rows)}")

    await pconn.close()
    sconn.close()


if __name__ == "__main__":
    asyncio.run(main())
