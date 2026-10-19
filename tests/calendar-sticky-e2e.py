"""Browser verification for the GitHub Pages static app."""

import os

from playwright.sync_api import sync_playwright
from urllib.parse import quote


def selected_day(page):
    return page.locator('#calendarGrid .day.selected')


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    page_errors = []
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    app_folder = quote('2026-10-19_晓霖自我支持工作台_GitHubPages_v1.1')
    app_port = os.environ.get('APP_PORT', '4173')
    page.goto(f'http://127.0.0.1:{app_port}/{app_folder}/', wait_until='networkidle')

    note = page.locator('#calendarStickyText')
    status = page.locator('#calendarStickyStatus')
    initial_key = page.evaluate('() => document.querySelector(".day.selected").className')

    note.fill('给未来的自己：先完成最重要的一件事。')
    assert status.inner_text() == '有未保存修改'
    assert page.evaluate('() => Object.keys(localStorage).some(k => k.startsWith("xiaolinCalendarStickyNote:"))') is False

    page.get_by_role('button', name='保存便利贴').click()
    assert status.inner_text() == '已保存'
    assert page.evaluate('() => Object.keys(localStorage).some(k => k.startsWith("xiaolinCalendarStickyNote:"))') is True
    assert 'has-note' in initial_key or page.locator('#calendarGrid .day.selected').evaluate('(el) => el.classList.contains("has-note")')

    page.locator('#calendarGrid .day:not(.selected)').nth(8).click()
    assert note.input_value() == ''

    note.fill('这是一条不应自动写入的草稿。')
    page.once('dialog', lambda dialog: dialog.dismiss())
    page.locator('#calendarGrid .day:not(.selected)').nth(9).click()
    assert note.input_value() == '这是一条不应自动写入的草稿。'
    assert status.inner_text() == '有未保存修改'

    page.once('dialog', lambda dialog: dialog.accept())
    page.locator('#calendarGrid .day:not(.selected)').nth(9).click()
    assert note.input_value() == ''

    page.locator('#calendarGrid .day.today').click()
    assert note.input_value() == '给未来的自己：先完成最重要的一件事。'
    page.reload(wait_until='networkidle')
    assert note.input_value() == '给未来的自己：先完成最重要的一件事。'
    assert page.locator('#calendarGrid .day.today').evaluate('(el) => el.classList.contains("has-note")')
    assert page_errors == [], page_errors

    browser.close()
    print('calendar sticky-note browser checks: passed')
