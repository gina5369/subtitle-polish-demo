from __future__ import annotations

from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components


APP_DIR = Path(__file__).resolve().parent


def read_text(name: str) -> str:
    return (APP_DIR / name).read_text(encoding="utf-8")


def escape_script(content: str) -> str:
    return content.replace("</script", "<\\/script")


def build_embedded_html() -> str:
    html = read_text("index.html")
    css = read_text("styles.css")
    mock_js = escape_script(read_text("mock-runtime.js"))
    app_js = escape_script(read_text("app.js"))

    html = html.replace(
        '<link rel="stylesheet" href="./styles.css" />',
        f"<style>\n{css}\n</style>",
    )

    start = html.index("    <script>\n      const params = new URLSearchParams(location.search);")
    end = html.index('    <script src="./app.js"></script>') + len(
        '    <script src="./app.js"></script>'
    )
    scripts = f'''    <script>
{mock_js}
    </script>
    <script>
{app_js}
    </script>'''

    return html[:start] + scripts + html[end:]


st.set_page_config(page_title="字幕润色质量检测 Demo", layout="wide")
components.html(build_embedded_html(), height=920, scrolling=True)
