#!/usr/bin/env python3
"""Compare or add missing assignment records from a restored database snapshot."""

import os
import sys
from collections import Counter

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


TABLES = {
    "assignments": "Assignment",
    "targets": "AssignmentTarget",
    "submissions": "AssignmentSubmission",
}


def table_columns(connection, table):
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            ORDER BY ordinal_position
            """,
            (table,),
        )
        return [row[0] for row in cursor.fetchall()]


def rows(connection, table, columns):
    query = sql.SQL("SELECT {columns} FROM {table}").format(
        columns=sql.SQL(", ").join(map(sql.Identifier, columns)),
        table=sql.Identifier(table),
    )
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(query)
        return cursor.fetchall()


def existing_ids(connection, table):
    with connection.cursor() as cursor:
        cursor.execute(
            sql.SQL("SELECT id FROM {}").format(sql.Identifier(table))
        )
        return {row[0] for row in cursor.fetchall()}


def existing_pairs(connection, table, left, right):
    with connection.cursor() as cursor:
        cursor.execute(
            sql.SQL("SELECT {}, {} FROM {}").format(
                sql.Identifier(left),
                sql.Identifier(right),
                sql.Identifier(table),
            )
        )
        return set(cursor.fetchall())


def existing_values(connection, table, column):
    with connection.cursor() as cursor:
        cursor.execute(
            sql.SQL("SELECT {} FROM {} WHERE {} IS NOT NULL").format(
                sql.Identifier(column),
                sql.Identifier(table),
                sql.Identifier(column),
            )
        )
        return {row[0] for row in cursor.fetchall()}


def unique_key(row, fields):
    return tuple(row[field] for field in fields)


def main():
    apply_changes = os.environ.get("APPLY_RESTORATION") == "true"
    source_url = os.environ["SNAPSHOT_DATABASE_URL"]
    target_url = os.environ["DIRECT_DATABASE_URL"]

    with (
        psycopg.connect(source_url) as snapshot,
        psycopg.connect(target_url) as production,
    ):
        source_columns = {
            name: table_columns(snapshot, table)
            for name, table in TABLES.items()
        }
        target_columns = {
            name: set(table_columns(production, table))
            for name, table in TABLES.items()
        }
        for name, table in TABLES.items():
            if "id" not in source_columns[name] or "id" not in target_columns[name]:
                raise RuntimeError(f"{table} is missing its expected id column")

        source_assignments = rows(
            snapshot, TABLES["assignments"], source_columns["assignments"]
        )
        source_targets = rows(
            snapshot, TABLES["targets"], source_columns["targets"]
        )
        source_submissions = rows(
            snapshot, TABLES["submissions"], source_columns["submissions"]
        )

        with snapshot.cursor() as cursor:
            cursor.execute(
                """
                SELECT l.id, u.name
                FROM "Lecturer" l
                JOIN "User" u ON u.id = l."userId"
                """
            )
            lecturer_names = {
                lecturer_id: (name or "")
                for lecturer_id, name in cursor.fetchall()
            }

        with production.cursor() as cursor:
            cursor.execute(
                """
                SELECT l.id, u.name
                FROM "Lecturer" l
                JOIN "User" u ON u.id = l."userId"
                """
            )
            production_lecturer_names = {
                lecturer_id: (name or "")
                for lecturer_id, name in cursor.fetchall()
            }

        live_assignment_ids = existing_ids(production, TABLES["assignments"])
        live_target_ids = existing_ids(production, TABLES["targets"])
        live_submission_ids = existing_ids(production, TABLES["submissions"])
        live_student_ids = existing_ids(production, "Student")
        live_lecturer_ids = existing_ids(production, "Lecturer")
        live_branch_ids = existing_ids(production, "Branch")
        live_tenant_ids = existing_ids(production, "Tenant")

        assignment_columns = [
            column
            for column in source_columns["assignments"]
            if column in target_columns["assignments"]
        ]
        target_columns_to_copy = [
            column
            for column in source_columns["targets"]
            if column in target_columns["targets"]
        ]
        submission_columns = [
            column
            for column in source_columns["submissions"]
            if column in target_columns["submissions"]
        ]

        target_pairs = existing_pairs(
            production, TABLES["targets"], "assignmentId", "studentId"
        )
        submission_pairs = existing_pairs(
            production, TABLES["submissions"], "assignmentId", "studentId"
        )

        missing_assignments = [
            row for row in source_assignments if row["id"] not in live_assignment_ids
        ]
        planned_assignment_ids = {row["id"] for row in missing_assignments}
        blocked = Counter()
        eligible_assignments = []
        for row in missing_assignments:
            if row.get("lecturerId") and row["lecturerId"] not in live_lecturer_ids:
                blocked["assignments_missing_lecturer"] += 1
            elif row.get("branchId") and row["branchId"] not in live_branch_ids:
                blocked["assignments_missing_branch"] += 1
            elif row.get("tenantId") and row["tenantId"] not in live_tenant_ids:
                blocked["assignments_missing_tenant"] += 1
            else:
                eligible_assignments.append(row)

        restorable_assignment_ids = live_assignment_ids | {
            row["id"] for row in eligible_assignments
        }
        target_candidates = [
            row
            for row in source_targets
            if row["id"] not in live_target_ids
            and unique_key(row, ("assignmentId", "studentId")) not in target_pairs
        ]
        eligible_targets = []
        for row in target_candidates:
            if row["assignmentId"] not in restorable_assignment_ids:
                blocked["targets_missing_assignment"] += 1
            elif row["studentId"] not in live_student_ids:
                blocked["targets_missing_student"] += 1
            elif row.get("tenantId") and row["tenantId"] not in live_tenant_ids:
                blocked["targets_missing_tenant"] += 1
            else:
                eligible_targets.append(row)

        submission_candidates = [
            row
            for row in source_submissions
            if row["id"] not in live_submission_ids
            and unique_key(row, ("assignmentId", "studentId")) not in submission_pairs
        ]
        eligible_submissions = []
        for row in submission_candidates:
            if row["assignmentId"] not in restorable_assignment_ids:
                blocked["submissions_missing_assignment"] += 1
            elif row["studentId"] not in live_student_ids:
                blocked["submissions_missing_student"] += 1
            elif row.get("tenantId") and row["tenantId"] not in live_tenant_ids:
                blocked["submissions_missing_tenant"] += 1
            else:
                eligible_submissions.append(row)

        yemisi_assignment_ids = {
            row["id"]
            for row in source_assignments
            if "yemisi" in lecturer_names.get(row.get("lecturerId"), "").casefold()
        }
        production_assignments = rows(
            production,
            TABLES["assignments"],
            ["id", "lecturerId"],
        )
        production_yemisi_assignment_ids = {
            row["id"]
            for row in production_assignments
            if "yemisi"
            in production_lecturer_names.get(row.get("lecturerId"), "").casefold()
        }
        yemisi_assignment_count = sum(
            row["id"] not in live_assignment_ids
            for row in source_assignments
            if row["id"] in yemisi_assignment_ids
        )
        yemisi_submission_count = sum(
            row["id"] not in live_submission_ids
            and unique_key(row, ("assignmentId", "studentId")) not in submission_pairs
            for row in source_submissions
            if row["assignmentId"] in yemisi_assignment_ids
        )
        production_submissions = rows(
            production,
            TABLES["submissions"],
            ["id", "assignmentId"],
        )
        yemisi_snapshot_submission_count = sum(
            row["assignmentId"] in yemisi_assignment_ids
            for row in source_submissions
        )
        yemisi_production_submission_count = sum(
            row["assignmentId"] in production_yemisi_assignment_ids
            for row in production_submissions
        )

        plan = {
            "assignments": eligible_assignments,
            "targets": eligible_targets,
            "submissions": eligible_submissions,
        }
        print("Snapshot comparison (no student names, answers, or file URLs are logged):")
        for name, source_rows, live_ids, candidates in (
            ("assignments", source_assignments, live_assignment_ids, missing_assignments),
            ("targets", source_targets, live_target_ids, target_candidates),
            ("submissions", source_submissions, live_submission_ids, submission_candidates),
        ):
            print(
                f"  {name}: snapshot={len(source_rows)}, production={len(live_ids)}, "
                f"missing={len(candidates)}, eligible={len(plan[name])}"
            )
        print(
            "  Frau Yemisi: "
            f"assignments snapshot={len(yemisi_assignment_ids)}, "
            f"production={len(production_yemisi_assignment_ids)}, "
            f"missing={yemisi_assignment_count}; "
            f"submissions snapshot={yemisi_snapshot_submission_count}, "
            f"production={yemisi_production_submission_count}, "
            f"missing={yemisi_submission_count}"
        )
        for reason, count in sorted(blocked.items()):
            print(f"  blocked ({reason})={count}")

        if blocked:
            raise RuntimeError("Recovery has unresolved dependencies; no rows were changed")

        if not apply_changes:
            print("Dry run only. No production rows were changed.")
            return

        inserted = Counter()
        with production.transaction():
            for name, table in TABLES.items():
                columns = [
                    column
                    for column in (
                        assignment_columns
                        if name == "assignments"
                        else target_columns_to_copy
                        if name == "targets"
                        else submission_columns
                    )
                ]
                insert_query = sql.SQL(
                    "INSERT INTO {table} ({columns}) VALUES ({values}) "
                    "ON CONFLICT DO NOTHING"
                ).format(
                    table=sql.Identifier(table),
                    columns=sql.SQL(", ").join(map(sql.Identifier, columns)),
                    values=sql.SQL(", ").join(sql.Placeholder() for _ in columns),
                )
                for row in plan[name]:
                    with production.cursor() as cursor:
                        values = [
                            Jsonb(row[column])
                            if column in {
                                "attachments",
                                "questions",
                                "files",
                                "answers",
                                "questionScores",
                            }
                            and row[column] is not None
                            else row[column]
                            for column in columns
                        ]
                        cursor.execute(
                            insert_query, values
                        )
                        inserted[name] += cursor.rowcount

        print("Production recovery committed (additive inserts only):")
        for name, count in inserted.items():
            print(f"  {name} inserted={count}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Recovery stopped: {error}", file=sys.stderr)
        raise
