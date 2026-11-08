"""Schema compatibility checks without connecting to any database."""
import unittest
from unittest.mock import patch

import restore


class UsernameRestoreTests(unittest.TestCase):
    def layout(self, username=False):
        rows = [f"{table}\t{column}" for table, (columns, _) in restore.TABLES.items()
                for column in columns.split()]
        if username:
            rows.append("users\tusername")
        return rows

    def check_layout(self, rows):
        with patch.object(restore, "root_sql", side_effect=["\n".join(rows), "7", "0"]):
            return restore.schema("disposable", "fixture")

    def test_legacy_schema(self):
        self.assertFalse(self.check_layout(self.layout()))

    def test_username_schema(self):
        self.assertTrue(self.check_layout(self.layout(True)))

    def test_unknown_column_rejected(self):
        with self.assertRaises(RuntimeError):
            self.check_layout(self.layout(True) + ["users\tunexpected"])

    def test_username_in_other_table_rejected(self):
        with self.assertRaises(RuntimeError):
            self.check_layout(self.layout(True) + ["tokens\tusername"])

    def test_missing_column_rejected(self):
        with self.assertRaises(RuntimeError):
            self.check_layout([r for r in self.layout() if r != "users\temail"])

    def test_transfer_preserves_and_verifies_usernames(self):
        with patch.object(restore, "root_sql", side_effect=["", "", "48"]) as sql:
            restore.transfer("disposable", "fixture", 48, True)
        statement = sql.call_args_list[0].args[1]
        self.assertIn("`created_at`,`username`) SELECT", statement)
        self.assertIn("CAST(d.`username` AS BINARY) <=> CAST(s.`username` AS BINARY)", statement)

    def test_legacy_transfer_does_not_invent_usernames(self):
        with patch.object(restore, "root_sql", side_effect=["", "", "48"]) as sql:
            restore.transfer("disposable", "fixture", 48, False)
        self.assertNotIn("`username`", sql.call_args_list[0].args[1])


if __name__ == "__main__":
    unittest.main()
