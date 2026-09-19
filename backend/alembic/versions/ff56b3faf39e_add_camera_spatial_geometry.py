"""add_camera_spatial_geometry

Revision ID: ff56b3faf39e
Revises: 
Create Date: 2026-09-10 21:13:48.264534

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import geoalchemy2  # Added missing import


# revision identifiers, used by Alembic.
revision: str = 'ff56b3faf39e'
down_revision: Union[str, None] = None
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None

def upgrade() -> None:
    # 1. Add column (with spatial_index=False so it doesn't double-create the index)
    op.add_column('cameras', sa.Column('geom', geoalchemy2.types.Geometry(
        geometry_type='POINT', 
        srid=4326, 
        dimension=2, 
        from_text='ST_GeomFromEWKT', 
        name='geometry', 
        spatial_index=False  # <-- THIS IS THE MAGIC FIX
    ), nullable=True))
    
    # 2. Convert existing lat/lng data into spatial points for the 15 existing cameras
    op.execute(
        "UPDATE cameras SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326) "
        "WHERE lng IS NOT NULL AND lat IS NOT NULL;"
    )

    # 3. Create the spatial index explicitly
    op.create_index('idx_cameras_geom', 'cameras', ['geom'], unique=False, postgresql_using='gist')


def downgrade() -> None:
    # Undo changes in reverse order
    op.drop_index('idx_cameras_geom', table_name='cameras', postgresql_using='gist')
    op.drop_column('cameras', 'geom')