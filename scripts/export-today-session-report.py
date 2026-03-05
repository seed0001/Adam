from __future__ import annotations

import argparse
import datetime as dt
import sqlite3
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Export today's Adam session report")
    p.add_argument("--db", default=str(Path.home() / ".adam" / "data" / "adam.db"))
    p.add_argument("--workspace", default=str(Path.cwd()))
    p.add_argument("--daemon-log", default=str(Path.home() / ".adam" / "logs" / "daemon.log"))
    p.add_argument("--output", default="")
    return p.parse_args()


def now_local() -> dt.datetime:
    return dt.datetime.now()


def today_prefix() -> str:
    return now_local().strftime("%Y-%m-%d")


def safe_read_text(path: Path) -> str:
    try:
      return path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
      return f"[read-error] {e}"


def fetch_today_messages(db_path: Path) -> list[dict]:
    if not db_path.exists():
        return []

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    # created_at is stored in ISO text. We filter by local date prefix for practical reporting.
    date_prefix = today_prefix() + "%"
    cur.execute(
        """
        SELECT
          m.id,
          m.created_at AS createdAt,
          m.session_id AS sessionId,
          m.role,
          m.source,
          m.content,
          s.channel_id AS channelId,
          s.user_id AS userId,
          s.title AS sessionTitle
        FROM episodic_memory m
        LEFT JOIN sessions s ON s.id = m.session_id
        WHERE m.deleted_at IS NULL
          AND m.created_at LIKE ?
        ORDER BY m.created_at ASC
        """,
        (date_prefix,),
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def fetch_today_daemon_lines(daemon_log: Path) -> list[str]:
    if not daemon_log.exists():
        return []
    prefix = today_prefix()
    lines = safe_read_text(daemon_log).splitlines()
    return [ln for ln in lines if ln.startswith(prefix)]


def gather_diagnostic_logs(workspace: Path) -> list[tuple[Path, str]]:
    diag_dir = workspace / ".diagnostics"
    if not diag_dir.exists():
        return []
    today = today_prefix()
    out: list[tuple[Path, str]] = []
    for p in sorted(diag_dir.glob("*.log")):
        try:
            mtime = dt.datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d")
        except Exception:  # noqa: BLE001
            mtime = ""
        if mtime == today:
            out.append((p, safe_read_text(p)))
    return out


def build_report(
    messages: list[dict],
    daemon_lines: list[str],
    diag_logs: list[tuple[Path, str]],
    workspace: Path,
    db_path: Path,
    daemon_log: Path,
) -> str:
    users = sum(1 for m in messages if m.get("role") == "user")
    assistants = sum(1 for m in messages if m.get("role") == "assistant")
    failures = [ln for ln in daemon_lines if "[ERROR]" in ln or "[WARN]" in ln or "failed" in ln.lower()]
    sessions = sorted({m.get("sessionId") for m in messages if m.get("sessionId")})

    out: list[str] = []
    out.append("Adam Daily Session Snapshot")
    out.append("==========================")
    out.append(f"Generated: {now_local().isoformat(timespec='seconds')}")
    out.append(f"Workspace: {workspace}")
    out.append(f"Database: {db_path}")
    out.append(f"Daemon log: {daemon_log}")
    out.append("")
    out.append("Summary")
    out.append("-------")
    out.append(f"- Messages today: {len(messages)}")
    out.append(f"- User messages: {users}")
    out.append(f"- Assistant messages: {assistants}")
    out.append(f"- Sessions touched: {len(sessions)}")
    out.append(f"- Daemon warning/error lines today: {len(failures)}")
    out.append(f"- Diagnostics log files today: {len(diag_logs)}")
    out.append("")

    out.append("Session IDs")
    out.append("-----------")
    for sid in sessions:
        out.append(f"- {sid}")
    out.append("")

    out.append("Input/Output Timeline (Today)")
    out.append("----------------------------")
    if not messages:
        out.append("(No episodic messages found for today.)")
    else:
        for m in messages:
            role = (m.get("role") or "").upper()
            created = m.get("createdAt") or ""
            source = m.get("source") or ""
            sid = m.get("sessionId") or ""
            content = (m.get("content") or "").rstrip()
            out.append(f"[{created}] [{role}] [{source}] session={sid}")
            out.append(content if content else "(empty)")
            out.append("")

    out.append("Daemon Failures / Warnings (Today)")
    out.append("----------------------------------")
    if not failures:
        out.append("(No warning/error lines found for today.)")
    else:
        out.extend(failures)
    out.append("")

    out.append("Diagnostics Process Logs (Today)")
    out.append("-------------------------------")
    if not diag_logs:
        out.append("(No .diagnostics/*.log files modified today.)")
    else:
        for p, content in diag_logs:
            out.append(f"### {p}")
            out.append(content.rstrip())
            out.append("")

    return "\n".join(out).rstrip() + "\n"


def main() -> None:
    args = parse_args()
    workspace = Path(args.workspace)
    db_path = Path(args.db)
    daemon_log = Path(args.daemon_log)

    messages = fetch_today_messages(db_path)
    daemon_lines = fetch_today_daemon_lines(daemon_log)
    diag_logs = gather_diagnostic_logs(workspace)

    report = build_report(messages, daemon_lines, diag_logs, workspace, db_path, daemon_log)

    output = Path(args.output) if args.output else workspace / "exports" / f"today-session-report-{now_local().strftime('%Y%m%d-%H%M%S')}.txt"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(report, encoding="utf-8")
    print(str(output))


if __name__ == "__main__":
    main()
