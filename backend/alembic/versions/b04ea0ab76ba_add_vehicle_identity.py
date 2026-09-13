"""add_vehicle_identity

Revision ID: b04ea0ab76ba
Revises: ff56b3faf39e
Create Date: 2026-09-12 15:39:54.937519

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b04ea0ab76ba"
down_revision: Union[str, None] = "ff56b3faf39e"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:

    # --------------------------------------------------------
    # 2. Add vehicle-centric observation fields
    # --------------------------------------------------------

    op.add_column(
        "plate_events",
        sa.Column(
            "vehicle_id",
            sa.String(length=36),
            nullable=True,
        ),
    )

    op.add_column(
        "plate_events",
        sa.Column(
            "vehicle_type",
            sa.String(length=30),
            nullable=False,
            server_default="unknown",
        ),
    )

    op.add_column(
        "plate_events",
        sa.Column(
            "color",
            sa.String(length=20),
            nullable=False,
            server_default="unknown",
        ),
    )

    # --------------------------------------------------------
    # 3. Indexes
    # --------------------------------------------------------

    op.create_index(
        "ix_plate_events_vehicle_id",
        "plate_events",
        ["vehicle_id"],
        unique=False,
    )

    op.create_index(
        "ix_vehicle_ts",
        "plate_events",
        ["vehicle_id", "timestamp"],
        unique=False,
    )

    # --------------------------------------------------------
    # 4. Vehicle foreign key
    # --------------------------------------------------------

    op.create_foreign_key(
        "fk_plate_events_vehicle_id",
        "plate_events",
        "vehicles",
        ["vehicle_id"],
        ["id"],
    )

    # --------------------------------------------------------
    # 5. Remove temporary server defaults.
    #
    # Existing events receive "unknown", but future inserts
    # are governed by the SQLAlchemy model default.
    # --------------------------------------------------------

    op.alter_column(
        "plate_events",
        "vehicle_type",
        server_default=None,
    )

    op.alter_column(
        "plate_events",
        "color",
        server_default=None,
    )


def downgrade() -> None:
    # --------------------------------------------------------
    # Reverse foreign key and indexes
    # --------------------------------------------------------

    op.drop_constraint(
        "fk_plate_events_vehicle_id",
        "plate_events",
        type_="foreignkey",
    )

    op.drop_index(
        "ix_vehicle_ts",
        table_name="plate_events",
    )

    op.drop_index(
        "ix_plate_events_vehicle_id",
        table_name="plate_events",
    )

    # --------------------------------------------------------
    # Remove vehicle observation fields
    # --------------------------------------------------------

    op.drop_column(
        "plate_events",
        "color",
    )

    op.drop_column(
        "plate_events",
        "vehicle_type",
    )

    op.drop_column(
        "plate_events",
        "vehicle_id",
    )

    