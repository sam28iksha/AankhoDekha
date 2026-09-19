import asyncio
from datetime import datetime, timezone, timedelta
from db.base import AsyncSessionLocal
from db.models import Camera
from anpr.pipeline import PlateEvent as PipelinePlateEvent
from api.ingest import _write_event_and_maybe_alert

async def trigger_cloned_plate():
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        
        # Fetch two distant cameras
        cam1 = await db.get(Camera, "cam_01") # Connaught Place
        cam2 = await db.get(Camera, "cam_09") # Akshardham
        
        print(f"Injecting sighting at {cam1.name}...")
        ev1 = PipelinePlateEvent(
            plate_number="FAKE8888", camera_id=cam1.id, 
            lat=cam1.lat, lng=cam1.lng, timestamp=now, confidence=0.99
        )
        await _write_event_and_maybe_alert(db, cam1, ev1)
        
        print(f"Injecting identical plate at {cam2.name} 5 seconds later...")
        # Added 5-second difference here!
        ev2 = PipelinePlateEvent(
            plate_number="FAKE8888", camera_id=cam2.id, 
            lat=cam2.lat, lng=cam2.lng, timestamp=now + timedelta(seconds=5), confidence=0.99
        )
        await _write_event_and_maybe_alert(db, cam2, ev2)

if __name__ == "__main__":
    asyncio.run(trigger_cloned_plate())