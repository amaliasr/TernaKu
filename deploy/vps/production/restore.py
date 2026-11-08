#!/usr/bin/env python3
"""Restore a full, frozen TernaKu dump into an unused ternaku-prod MySQL volume."""
import argparse
import hashlib
import hmac
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys


PROJECT = "ternaku-prod"
TABLES = {
    "users": ("id name email password_hash role active target created_at", "id"),
    "records": ("id sequence kind user_id occurred_at data created_at", "id"),
    "tokens": ("token_hash user_id expires_at created_at", "token_hash"),
    "login_attempts": ("attempt_key attempts started_at", "attempt_key"),
    "stock": ("stock_key eggs kg trays", "stock_key"),
    "command_requests": ("user_id request_id fingerprint created_at", "user_id request_id"),
    "command_mutex": ("id version", "id"),
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(cmd, stdin=None):
    result = subprocess.run(cmd, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # MySQL errors may quote entire INSERTs, including tokens and image data.
        code = re.search(rb"ERROR [0-9]+ \([A-Z0-9]+\)", result.stderr)
        label = " (" + code[0].decode() + ")" if code else ""
        raise RuntimeError("Command failed" + label)
    return result.stdout.decode().strip()


def docker(*args):
    return run(["docker", *args])


def offline_db():
    project_filter = "label=com.docker.compose.project=" + PROJECT
    cid = docker("ps", "-q", "--filter", project_filter, "--filter", "label=com.docker.compose.service=db")
    require(re.fullmatch("[0-9a-f]{12,64}", cid), "Expected exactly one running production db container.")
    require(docker("ps", "-q", "--filter", project_filter) == cid, "Stop production api, web and worker before restoring.")
    require(not docker("port", cid), "The database must be private.")
    volume = docker("inspect", "-f", '{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{.Name}}{{end}}{{end}}', cid)
    label = '{{index .Labels "com.docker.compose.project"}}'
    require(volume == "ternaku-prod_mysql_data" and docker("volume", "inspect", "-f", label, volume) == PROJECT,
            "Unexpected MySQL volume.")
    net = docker("inspect", "-f", '{{range $n,$v := .NetworkSettings.Networks}}{{$n}}{{println}}{{end}}', cid)
    require(net == "ternaku-prod_data" and docker("network", "inspect", "-f", label + " {{.Internal}}", net) == PROJECT + " true",
            "Expected the isolated internal production network.")
    return cid


def root_sql(cid, query):
    cmd = ["docker", "exec", "-i", cid, "sh", "-ec",
           'test "$MYSQL_DATABASE" = ternaku && test "$MYSQL_USER" = ternaku && test -n "$MYSQL_ROOT_PASSWORD"; '
           'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; '
           'exec mysql --protocol=SOCKET --user=root --batch --raw --skip-column-names '
           '--local-infile=0 --binary-mode=1 --default-character-set=utf8mb4 ternaku']
    return run(cmd, ("SET SESSION information_schema_stats_expiry=0;\n" + query + "\n").encode())


def counts(cid, db):
    return {name: int(count) for name, count in zip(TABLES, root_sql(cid, "SELECT " + ",".join(
        "(SELECT COUNT(*) FROM " + db + "." + t + ")" for t in TABLES) + ";").split())}


def schema(cid, db):
    rows = root_sql(cid, "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='" +
                    db + "' ORDER BY table_name,ordinal_position;").splitlines()
    actual = {}
    for row in rows:
        table, col = row.split("\t")
        actual.setdefault(table, []).append(col)
    expected = {t: cols.split() for t, (cols, _) in TABLES.items()}
    legacy = {t: [c for c in cols if c != "username"] for t, cols in actual.items()}
    require(legacy == expected and actual.get("users", []).count("username") <= 1,
            "Unexpected table or column layout in " + db)
    require(all("username" not in cols for t, cols in actual.items() if t != "users"),
            "Unexpected username column outside users in " + db)
    require(root_sql(cid, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='" + db +
                     "' AND engine='InnoDB';") == "7", "All seven tables must be InnoDB.")
    require(root_sql(cid, "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='" + db + "';") == "0",
            "Unexpected database triggers.")
    return "username" in actual["users"]


FRESH = """(SELECT COUNT(*) FROM users)=0 AND (SELECT COUNT(*) FROM records)=0
 AND (SELECT COUNT(*) FROM tokens)=0 AND (SELECT COUNT(*) FROM login_attempts)=0
 AND (SELECT COUNT(*) FROM command_requests)=0 AND (SELECT COUNT(*) FROM stock)=2
 AND (SELECT COUNT(*) FROM stock WHERE stock_key IN ('egg:good','egg:cracked') AND eggs=0 AND kg=0 AND trays=0)=2
 AND (SELECT COUNT(*) FROM command_mutex)=1 AND (SELECT COUNT(*) FROM command_mutex WHERE id=1 AND version=0)=1"""


def import_scratch(cid, dump, sha256, scratch, account, password):
    # The import account has rights only on a unique, disposable schema. It cannot
    # change the real database, even if the dump contains database-qualified SQL.
    cmd = ["docker", "exec", "-i", cid, "sh", "-ec",
           'IFS= read -r MYSQL_PWD; export MYSQL_PWD; exec mysql --protocol=SOCKET --user="$1" '
           '--database="$2" --default-character-set=utf8mb4 --binary-mode=1 --local-infile=0', "sh", account, scratch]
    digest = hashlib.sha256()
    with dump.open("rb") as source, subprocess.Popen(cmd, stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as sql:
        try:
            sql.stdin.write(password.encode() + b"\n")
            for line in source:
                digest.update(line)
                # Only the known MariaDB table collation in the DDL needs translation.
                if line.startswith(b") ENGINE="):
                    line = line.replace(b"COLLATE=utf8mb4_uca1400_ai_ci", b"COLLATE=utf8mb4_unicode_ci")
                if line.startswith(b"/*M!999999\\- enable the sandbox mode */"):
                    continue
                sql.stdin.write(line)
            sql.stdin.close()
        except BrokenPipeError:
            pass
        require(sql.wait() == 0, "Scratch import failed. Check the SQL export format.")
    require(hmac.compare_digest(digest.hexdigest(), sha256), "The imported dump does not match the transfer SHA-256.")


def next_sequence_query(db):
    return "SELECT AUTO_INCREMENT FROM information_schema.tables WHERE table_schema='" + db + "' AND table_name='records'"


def transfer(cid, scratch, next_sequence, include_username=False):
    # An assertion failure terminates the batch before COMMIT. Closing the
    # connection rolls back the entire data transfer, including the two seed rows.
    statements = ["SET NAMES utf8mb4; SET time_zone='+00:00';",
                  "CREATE TEMPORARY TABLE restore_check (ok TINYINT NOT NULL CHECK(ok=1));",
                  "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE; START TRANSACTION;",
                  "SELECT version INTO @locked_version FROM command_mutex WHERE id=1 FOR UPDATE;"]

    def check(predicate):
        statements.append("INSERT INTO restore_check SELECT IF((" + predicate + "),1,0);")

    check(FRESH)
    statements.append("DELETE FROM stock; DELETE FROM command_mutex;")
    for name, (columns, pk) in TABLES.items():
        src, dst = scratch + "." + name, "ternaku." + name
        columns = columns.split()
        if name == "users" and include_username:
            columns.append("username")
        names = ",".join("`" + c + "`" for c in columns)
        statements.append(f"INSERT INTO {dst} ({names}) SELECT {names} FROM {src};")
        check(f"(SELECT COUNT(*) FROM {src})=(SELECT COUNT(*) FROM {dst})")
        # The raw identifier bytes are stable across MariaDB/MySQL collations.
        join = " AND ".join(f"d.`{c}`=CAST(s.`{c}` AS BINARY)" for c in pk.split())
        equal = " AND ".join(f"(CAST(d.`{c}` AS BINARY) <=> CAST(s.`{c}` AS BINARY))" for c in columns)
        check(f"NOT EXISTS (SELECT 1 FROM {src} s LEFT JOIN {dst} d ON {join} "
              f"WHERE d.`{pk.split()[0]}` IS NULL OR NOT ({equal}))")
    statements.append("COMMIT;")
    root_sql(cid, "\n".join(statements))
    # Explicit IDs preserve individual price cursors. Retain the original high
    # water mark as well, even if the most recently assigned rows were deleted.
    root_sql(cid, "ALTER TABLE records AUTO_INCREMENT=" + str(next_sequence) + ";")
    require(int(root_sql(cid, next_sequence_query("ternaku") + ";")) == next_sequence, "Sequence check failed. Keep production offline.")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="Verify the dump in scratch without populating production")
    mode.add_argument("--apply", action="store_true", help="Restore and verify the previously unused database")
    p.add_argument("dump", type=Path)
    p.add_argument("--sha256", required=True, help="SHA-256 measured on the source copy before transferring it")
    p.add_argument("--counts", help="Optional exact frozen-source counts for all seven tables: users=5,records=108,...")
    args = p.parse_args()
    os.umask(0o077)
    require(args.dump.is_absolute() and args.dump.is_file() and not args.dump.is_symlink()
            and stat.S_IMODE(args.dump.stat().st_mode) in (0o400, 0o600), "Use an absolute private mode 0400 or 0600 dump file.")
    require(re.fullmatch("[0-9a-fA-F]{64}", args.sha256), "Expected a 64-character SHA-256.")
    expected = None
    if args.counts is not None:
        items = args.counts.split(",")
        require(len(items) == len(TABLES) and all(re.fullmatch(r"[a-z_]+=[0-9]+", x) for x in items),
                "Provide one numeric count for each of the seven tables.")
        expected = {k: int(v) for k, v in (x.split("=") for x in items)}
        require(set(expected) == set(TABLES), "The counts must include all seven tables.")
    cid = offline_db()
    require(root_sql(cid, "SELECT VERSION() LIKE '8.4.%';") == "1", "Expected MySQL 8.4.")
    target_username = schema(cid, "ternaku")
    require(root_sql(cid, "SELECT " + FRESH + ";") == "1", "Production contains existing data. Refusing to overwrite.")
    suffix = secrets.token_hex(8)
    scratch, account, password = "ternaku_restore_" + suffix, "tmp_" + suffix, secrets.token_hex(28)
    root_sql(cid, "CREATE DATABASE " + scratch + " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;")
    try:
        root_sql(cid, f"CREATE USER '{account}'@'localhost' IDENTIFIED BY '{password}';")
        try:
            root_sql(cid, f"GRANT SELECT,INSERT,CREATE,DROP,ALTER,INDEX,REFERENCES,LOCK TABLES ON `{scratch}`.* TO '{account}'@'localhost';")
            import_scratch(cid, args.dump, args.sha256.lower(), scratch, account, password)
        finally:
            root_sql(cid, f"DROP USER '{account}'@'localhost';")
        source_username = schema(cid, scratch)
        require(not source_username or target_username,
                "Source contains usernames. Upgrade the empty target schema before restoring.")
        source = counts(cid, scratch)
        require(expected is None or source == expected, "Independent source counts do not match this dump.")
        require(root_sql(cid, "SELECT COUNT(*) FROM " + scratch + ".users WHERE active=1 AND role='admin';") != "0", "No active admin in source.")
        require(source["command_mutex"] == 1 and root_sql(cid, "SELECT id FROM " + scratch + ".command_mutex;") == "1", "Source mutex is missing.")
        require(root_sql(cid, "SELECT COUNT(*) FROM " + scratch + ".stock WHERE stock_key IN ('egg:good','egg:cracked');") == "2", "Missing egg stock rows.")
        next_sequence = int(root_sql(cid, next_sequence_query(scratch) + ";"))
        require(next_sequence > int(root_sql(cid, f"SELECT COALESCE(MAX(sequence),0) FROM {scratch}.records;")), "Invalid next record sequence.")
        print("Verified dump counts", source, flush=True)
        if args.apply:
            require(offline_db() == cid, "Database container changed before restore.")
            transfer(cid, scratch, next_sequence, source_username)
            require(counts(cid, "ternaku") == source, "Post-commit counts differ. Keep production offline.")
            print("Committed and verified every column in every row, including photo payloads, sessions, push subscriptions and pending jobs.")
    finally:
        root_sql(cid, "DROP DATABASE " + scratch + ";")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, RuntimeError) as error:
        sys.exit(str(error))
