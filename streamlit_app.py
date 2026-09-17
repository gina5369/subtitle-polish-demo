from __future__ import annotations

import json
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components


APP_DIR = Path(__file__).resolve().parent


def read_text(name: str) -> str:
    return (APP_DIR / name).read_text(encoding="utf-8")


def escape_script(content: str) -> str:
    return content.replace("</script", "<\\/script")


def read_secret(name: str) -> str:
    try:
        return str(st.secrets.get(name, "")).strip()
    except FileNotFoundError:
        return ""


def json_for_script(value: object) -> str:
    return json.dumps(value, ensure_ascii=False).replace("</", "<\\/")


def build_embedded_html(
    api_base_url: str,
    direct_tech_api_base: str,
    direct_tech_api_key: str,
) -> str:
    html = read_text("index.html")
    css = read_text("styles.css")
    app_js = escape_script(read_text("app.js"))

    html = html.replace(
        '<link rel="stylesheet" href="./styles.css" />',
        f"<style>\n{css}\n</style>",
    )

    start = html.index("    <script>\n      const params = new URLSearchParams(location.search);")
    end = html.index('    <script src="./app.js"></script>') + len(
        '    <script src="./app.js"></script>'
    )
    if api_base_url:
        api_base_url = api_base_url.rstrip("/")
        runtime_settings = {
            "subtitlePolishPolishEndpoint": f"{api_base_url}/api/subtitle/polish",
            "subtitlePolishQualityEndpoint": f"{api_base_url}/api/subtitle/polish/quality-check",
        }
        scripts = f'''    <script>
Object.assign(window, {json_for_script(runtime_settings)});
    </script>
    <script>
{app_js}
    </script>'''
    elif direct_tech_api_key:
        runtime_settings = {
            "subtitlePolishUseDirectRuntime": True,
            "subtitlePolishDirectTechEndpoint": direct_tech_api_base.rstrip("/"),
            "subtitlePolishDirectXApiKey": direct_tech_api_key,
        }
        scripts = f'''    <script>
Object.assign(window, {json_for_script(runtime_settings)});
    </script>
    <script>
{app_js}
    </script>'''
    else:
        mock_js = escape_script(read_text("mock-runtime.js"))
        scripts = f'''    <script>
{mock_js}
    </script>
    <script>
{app_js}
    </script>'''

    return html[:start] + scripts + html[end:]


st.set_page_config(page_title="字幕润色质量检测 Demo", layout="wide")
components.html(
    build_embedded_html(
        read_secret("REAL_API_BASE_URL"),
        read_secret("DIRECT_TECH_API_BASE") or "devaw.aoscdn.com/tech",
        read_secret("DIRECT_TECH_API_KEY"),
    ),
    height=920,
    scrolling=True,
)
