"""Retain the dispatch-time deadline policy across worker/control-plane loss."""
from alembic import op
import sqlalchemy as sa

revision = "0011_remote_attempt_deadlines"
down_revision = "0010_remote_worker_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = op.get_bind().execute(sa.text("PRAGMA table_info(remote_task_attempts)"))
    if not any(row[1] == "deadlines_json" for row in columns):
        op.add_column("remote_task_attempts", sa.Column("deadlines_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("remote_task_attempts", "deadlines_json")
