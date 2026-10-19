"""The downloadable HTML must render a complete month when opened as a local file."""

from pathlib import Path

from playwright.sync_api import sync_playwright


app_file = Path(__file__).parents[1] / 'index.html'

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(app_file.as_uri(), wait_until='networkidle')

    diagnostic = page.evaluate(
        """() => ({
          readyState: document.readyState,
          stateModule: typeof window.stickyNoteState,
          title: document.querySelector('#calendarMonth').textContent,
          days: document.querySelectorAll('#calendarGrid .day').length
        })"""
    )
    assert diagnostic['title'].strip(), {"errors": errors, "diagnostic": diagnostic}
    assert page.locator('#calendarGrid .day').count() == 42, errors
    browser.close()
    print('local file month-calendar preview: passed')
