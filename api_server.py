from __future__ import annotations

import asyncio
import os
from collections.abc import Mapping
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware


API_BASE_URL = os.getenv("TECH_API_BASE_URL", "https://devaw.aoscdn.com/tech").rstrip("/")
API_KEY = os.getenv("TECH_API_KEY", "").strip()
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS", "https://subtitle-polish-demo-gina.streamlit.app"
    ).split(",")
    if origin.strip()
]
TASK_POLL_INTERVAL_SECONDS = 2
TASK_MAX_ATTEMPTS = 300

app = FastAPI(title="Subtitle Polish API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type"],
)


def require_api_key() -> str:
    if not API_KEY:
        raise HTTPException(status_code=500, detail="TECH_API_KEY is not configured")
    return API_KEY


def extract_task_id(value: Any) -> str:
    if isinstance(value, Mapping):
        for key in ("task_id", "taskId", "taskid", "taskID", "id"):
            task_id = value.get(key)
            if task_id not in (None, ""):
                return str(task_id)
        for nested in ("data", "result", "payload"):
            task_id = extract_task_id(value.get(nested))
            if task_id:
                return task_id
    return ""


def task_variables(job_type: str, payload: Mapping[str, Any]) -> dict[str, str]:
    subtitles = payload.get("subtitles") or payload.get("polished_subtitles") or payload.get("translated_content") or []
    values = {
        "PROMPT": str(payload.get("prompt", "")),
        "prompt": str(payload.get("prompt", "")),
        "INPUT": str(payload.get("prompt", "")),
        "input": str(payload.get("prompt", "")),
        "CONTENT": str(payload.get("prompt", "")),
        "content": str(payload.get("prompt", "")),
        "USER_CONTENT": str(payload.get("prompt", "")),
        "user_content": str(payload.get("prompt", "")),
        "SUBTITLES_JSON": json_dumps(subtitles),
        "subtitles_json": json_dumps(subtitles),
        "SUBTITLE_LEN": str(payload.get("subtitle_len", "")),
        "subtitle_len": str(payload.get("subtitle_len", "")),
        "FILE_INDEX": str(payload.get("file_index", "")),
        "file_index": str(payload.get("file_index", "")),
    }
    if job_type == "quality":
        values.update(
            {
                "POLISH_TEMPLATE_ID": str(payload.get("polish_template_id", "")),
                "polish_template_id": str(payload.get("polish_template_id", "")),
                "ORIGINAL_SUBTITLES_JSON": json_dumps(payload.get("original_subtitles") or []),
                "original_subtitles_json": json_dumps(payload.get("original_subtitles") or []),
                "POLISHED_SUBTITLES_JSON": json_dumps(payload.get("polished_subtitles") or subtitles),
                "polished_subtitles_json": json_dumps(payload.get("polished_subtitles") or subtitles),
            }
        )
    return values


def json_dumps(value: Any) -> str:
    import json

    return json.dumps(value, ensure_ascii=False)


async def create_and_wait(job_type: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    api_key = require_api_key()
    template_id = str(payload.get("template_id", "")).strip()
    if not template_id:
        raise HTTPException(status_code=400, detail="template_id is required")

    create_body = {
        "response_type": 0,
        "template_id": template_id,
        "template_variables": json_dumps(task_variables(job_type, payload)),
        "po": "reccloud",
    }
    headers = {"Content-Type": "application/json", "x-api-key": api_key}
    task_url = f"{API_BASE_URL}/tasks/llm/chats"
    timeout = httpx.Timeout(30.0, read=60.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            create_response = await client.post(task_url, headers=headers, json=create_body)
            create_response.raise_for_status()
            created = create_response.json()
        except httpx.HTTPStatusError as error:
            raise HTTPException(status_code=502, detail=f"Task creation failed: HTTP {error.response.status_code}") from error
        except httpx.HTTPError as error:
            raise HTTPException(status_code=502, detail=f"Task creation failed: {error}") from error

        task_id = extract_task_id(created)
        if not task_id:
            raise HTTPException(status_code=502, detail="Task creation response did not include a task id")

        for _ in range(TASK_MAX_ATTEMPTS):
            await asyncio.sleep(TASK_POLL_INTERVAL_SECONDS)
            try:
                response = await client.get(f"{task_url}/{task_id}", headers={"x-api-key": api_key})
                response.raise_for_status()
                result = response.json()
            except httpx.HTTPStatusError as error:
                raise HTTPException(status_code=502, detail=f"Task query failed: HTTP {error.response.status_code}") from error
            except httpx.HTTPError as error:
                raise HTTPException(status_code=502, detail=f"Task query failed: {error}") from error

            data = result.get("data", result) if isinstance(result, Mapping) else {}
            state = data.get("state", data.get("data", {}).get("state")) if isinstance(data, Mapping) else None
            if state == 1:
                return {"task_id": task_id, "data": data, "query_response": result}
            if isinstance(state, (int, float)) and state < 0:
                raise HTTPException(status_code=502, detail="The model task failed")

    raise HTTPException(status_code=504, detail="The model task timed out")


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/api/subtitle/polish")
async def polish(payload: dict[str, Any]) -> dict[str, Any]:
    return await create_and_wait("polish", payload)


@app.post("/api/subtitle/polish/quality-check")
async def quality_check(payload: dict[str, Any]) -> dict[str, Any]:
    return await create_and_wait("quality", payload)
