"""Schema compatibility checks without connecting to any database."""
import unittest
from unittest.mock import patch

import restore


class AccountRestoreTests(unittest.TestCase):
    def layout(self, username=False, account_policy=False, compact=False, stock_check=False):
        rows = [f"{table}\t{column}\t-" for table, (columns, _) in restore.TABLES.items()
                for column in columns.split()]
        if username:
            rows.append("users\tusername\t-")
        if account_policy:
            rows.extend(["users\tis_superadmin\t-", "users\tdeleted_at\t-"])
        if compact:
            rows.extend(["records\tcompact_data\tSTORED GENERATED", "records\tphoto_version\tSTORED GENERATED"])
        if stock_check:
            rows.append("users\tcan_check_stock\t-")
        return rows

    def check_layout(self, rows):
        with patch.object(restore, "root_sql", side_effect=["\n".join(rows), "7", "0"]):
            return restore.schema("disposable", "fixture")

    def test_legacy_schema(self):
        self.assertEqual(self.check_layout(self.layout()), frozenset())

    def test_username_schema(self):
        self.assertEqual(self.check_layout(self.layout(True)), {"username"})

    def test_full_schema(self):
        self.assertEqual(self.check_layout(self.layout(True, True, True)),
                         {"username", "is_superadmin", "deleted_at", "compact_data", "photo_version"})

    def test_stock_checker_permission_is_an_optional_persisted_account_column(self):
        self.assertIn("can_check_stock", self.check_layout(self.layout(True, True, True, True)))
        with self.assertRaises(RuntimeError):
            self.check_layout(self.layout() + ["records\tcan_check_stock\t-"])

    def test_datetime_defaults_can_be_generated_without_being_derived_columns(self):
        rows = [r.replace("created_at\t-", "created_at\tDEFAULT_GENERATED") for r in self.layout()]
        self.assertEqual(self.check_layout(rows), frozenset())

    def test_unknown_column_rejected(self):
        with self.assertRaises(RuntimeError):
            self.check_layout(self.layout(True) + ["users\tunexpected\t-"])

    def test_username_in_other_table_rejected(self):
        with self.assertRaises(RuntimeError):
            self.check_layout(self.layout(True) + ["tokens\tusername\t-"])

    def test_account_policy_columns_in_other_tables_rejected(self):
        for table, column in [("tokens", "is_superadmin"), ("records", "deleted_at")]:
            with self.assertRaises(RuntimeError):
                self.check_layout(self.layout(True) + [f"{table}\t{column}\t-"])

    def test_nonstored_projection_rejected(self):
        for extra in ["-", "VIRTUAL GENERATED"]:
            with self.assertRaises(RuntimeError):
                self.check_layout(self.layout(True) + [f"records\tcompact_data\t{extra}"])

    def test_generated_original_data_rejected(self):
        with self.assertRaises(RuntimeError):
            self.check_layout([r.replace("records\tdata\t-", "records\tdata\tSTORED GENERATED") for r in self.layout()])

    def test_missing_column_rejected(self):
        with self.assertRaises(RuntimeError):
            self.check_layout([r for r in self.layout() if r != "users\temail\t-"])

    def test_transfer_preserves_and_verifies_usernames(self):
        with patch.object(restore, "root_sql", side_effect=["", "", "48"]) as sql:
            restore.transfer("disposable", "fixture", 48, ("username",))
        statement = sql.call_args_list[0].args[1]
        self.assertIn("`created_at`,`username`) SELECT", statement)
        self.assertIn("CAST(d.`username` AS BINARY) <=> CAST(s.`username` AS BINARY)", statement)

    def test_legacy_transfer_does_not_invent_usernames(self):
        with patch.object(restore, "root_sql", side_effect=["", "", "48"]) as sql:
            restore.transfer("disposable", "fixture", 48)
        self.assertNotIn("`username`", sql.call_args_list[0].args[1])

    def test_transfer_preserves_all_account_columns_and_recomputes_generated_fields(self):
        features = set(restore.ACCOUNT_COLUMNS) | set(restore.GENERATED_RECORD_COLUMNS)
        columns = restore.compatible_account_columns(features, features)
        with patch.object(restore, "root_sql", side_effect=["", "", "48"]) as sql:
            restore.transfer("disposable", "fixture", 48, columns)
        statement = sql.call_args_list[0].args[1]
        for column in restore.ACCOUNT_COLUMNS:
            self.assertIn(f"CAST(d.`{column}` AS BINARY) <=> CAST(s.`{column}` AS BINARY)", statement)
        for column in restore.GENERATED_RECORD_COLUMNS:
            self.assertNotIn(column, statement)
        self.assertIn("CAST(d.`data` AS BINARY) <=> CAST(s.`data` AS BINARY)", statement)

    def test_source_account_columns_cannot_be_lost(self):
        for missing in restore.ACCOUNT_COLUMNS:
            with self.assertRaises(RuntimeError):
                restore.compatible_account_columns(set(restore.ACCOUNT_COLUMNS), set(restore.ACCOUNT_COLUMNS) - {missing})

    def test_old_dump_uses_new_target_defaults(self):
        features = set(restore.ACCOUNT_COLUMNS) | set(restore.GENERATED_RECORD_COLUMNS)
        self.assertEqual(restore.compatible_account_columns(set(), features), ())
        self.assertEqual(restore.compatible_account_columns({"username"}, features), ("username",))

    def test_derived_source_columns_do_not_require_target_columns(self):
        self.assertEqual(restore.compatible_account_columns(set(restore.GENERATED_RECORD_COLUMNS), set()), ())

    def test_transfer_rejects_generated_fields_as_writable_account_columns(self):
        with self.assertRaises(RuntimeError):
            restore.transfer("disposable", "fixture", 48, ("compact_data",))

    def test_egg_stock_layout_is_complete_legacy_or_current(self):
        restore.validate_egg_stock_keys(["egg:good", "egg:cracked"])
        restore.validate_egg_stock_keys(["egg:good", "egg:cracked", "egg:skm", "egg:skm_new"])
        for keys in [[], ["egg:good"], ["egg:good", "egg:cracked", "egg:skm"],
                     ["egg:good", "egg:cracked", "egg:unknown"], ["egg:good", "egg:cracked", "egg:good"]]:
            with self.assertRaises(RuntimeError):
                restore.validate_egg_stock_keys(keys)

    def test_transfer_preserves_stock_rows_and_quantities_without_reclassification(self):
        with patch.object(restore, "root_sql", side_effect=["", "", "48"]) as sql:
            restore.transfer("disposable", "fixture", 48)
        statement = sql.call_args_list[0].args[1]
        self.assertIn("INSERT INTO ternaku.stock (`stock_key`,`eggs`,`kg`,`trays`) SELECT", statement)
        for column in ("stock_key", "eggs", "kg", "trays"):
            self.assertIn(f"CAST(d.`{column}` AS BINARY) <=> CAST(s.`{column}` AS BINARY)", statement)


if __name__ == "__main__":
    unittest.main()
