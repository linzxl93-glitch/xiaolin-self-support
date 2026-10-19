"""Ensure the month calendar is the primary, fully visible desktop view."""

import os
from urllib.parse import quote

from playwright.sync_api import sync_playwright


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    app_folder = quote('2026-10-19_晓霖自我支持工作台_GitHubPages_v1.1')
    port = os.environ.get('APP_PORT', '4173')
    page.goto(f'http://127.0.0.1:{port}/{app_folder}/', wait_until='networkidle')

    layout = page.locator('.calendar-shell').evaluate(
        """el => ({
          columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
          calendarWidth: document.querySelector('.calendar-card').getBoundingClientRect().width,
          calendarHeight: document.querySelector('.calendar-card').getBoundingClientRect().height,
          days: document.querySelectorAll('#calendarGrid .day').length
        })"""
    )

    assert layout['columns'] == 1, layout
    assert layout['calendarWidth'] >= 900, layout
    assert layout['calendarHeight'] <= 560, layout
    assert layout['days'] == 42, layout
    browser.close()
    print('calendar full-month layout check: passed')
