import logging
import os
import random

from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient


MONGO_URL = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
app = FastAPI()
logger = logging.getLogger('uvicorn.error')

client: AsyncIOMotorClient = None
db = None


@app.on_event('startup')
async def startup_db_client():
    global client, db
    logger.info(f'Connecting to MongoDB at {MONGO_URL}...')
    client = AsyncIOMotorClient(MONGO_URL)
    db = client.benchmark_db

    try:
        await client.admin.command('ping')
        logger.info('Successfully connected to MongoDB')
    except Exception as e:
        logger.error(f'Failed to connect to MongoDB: {e}')
        db = None


@app.on_event('shutdown')
async def shutdown_db_client():
    if client:
        client.close()


@app.get('/hello')
async def hello_points(
    count: int = Query(10, ge=1, le=10000)
):
    if db is None:
        return JSONResponse({'message': 'MongoDB is not connected'}, status_code=404)

    points = []
    for _ in range(count):
        points.append({
            'x': round(random.uniform(-100.0, 100.0), 3),
            'y': round(random.uniform(-100.0, 100.0), 3),
            'z': round(random.uniform(-100.0, 100.0), 3)
        })

    log_entry = {
        'event': 'hello_request',
        'points_count': count,
        'generated_sample': points[:5],
    }
    new_log = await db.logs.insert_one(log_entry)

    return {
        'message': f'Generated {count} points',
        'log_record_id': str(new_log.inserted_id),
        'points': points
    }


@app.get('/logs')
async def get_logs(
    start: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100)
):
    if db is None:
        return JSONResponse({'message': 'MongoDB is not connected'}, status_code=404)

    cursor = db.logs.find().skip(start).limit(limit)
    logs_list = await cursor.to_list(length=limit)

    for log in logs_list:
        log['_id'] = str(log['_id'])

    return {
        'pagination': {
            'start': start,
            'limit': limit,
            'count_returned': len(logs_list)
        },
        'data': logs_list
    }
