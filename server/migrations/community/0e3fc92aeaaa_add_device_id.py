"""Add device id

Revision ID: 0e3fc92aeaaa
Revises: a5d4defded55
Create Date: 2024-05-03 11:24:46.040646

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0e3fc92aeaaa"
down_revision = "a5d4defded55"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("login_history", sa.Column("device_id", sa.String(), nullable=True))
    op.create_index(
        op.f("ix_login_history_device_id"), "login_history", ["device_id"], unique=False
    )
    op.add_column("project_version", sa.Column("device_id", sa.String(), nullable=True))
    op.create_index(
        op.f("ix_project_version_device_id"),
        "project_version",
        ["device_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(op.f("ix_project_version_device_id"), table_name="project_version")
    op.drop_column("project_version", "device_id")
    op.drop_index(op.f("ix_login_history_device_id"), table_name="login_history")
    op.drop_column("login_history", "device_id")
