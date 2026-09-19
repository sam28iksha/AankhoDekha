import asyncio
import time

from db.base import AsyncSessionLocal
from analytics.congestion import get_speed_estimates


async def run_benchmark():
    async with AsyncSessionLocal() as db:
        print("Running Python/Haversine benchmark...")

        start = time.perf_counter()
        results = await get_speed_estimates(db, hours=24)
        duration_ms = (time.perf_counter() - start) * 1000

        print(f"Execution time: {duration_ms:.2f} ms")
        print(f"Camera-pair results: {len(results)}")


if __name__ == "__main__":
    asyncio.run(run_benchmark())