"""Private dispatcher bot. Site owns bookings; this service owns message delivery."""
import asyncio
import contextlib
import hashlib
import html
import json
import logging
import os
import re
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import aiohttp
from aiogram import Bot, Dispatcher, BaseMiddleware
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.middlewares.base import BaseRequestMiddleware
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError, TelegramRetryAfter
from aiogram.filters import Command, CommandStart
from aiogram.types import CopyTextButton, InlineKeyboardButton, InlineKeyboardMarkup, LinkPreviewOptions

DAY = 86400
KRASNOYARSK = timezone(timedelta(hours=7))
CUSTOM_EMOJI = {
    '📞': '6041650621776401666', '🟠': '5846127793313681804',
    '🟢': '5845901478601953249', '⚪': '5846127793313681804',
    '🔴': '5846210329700217522', '📅': '5274055917766202507',
    '💳': '5848392697072586723', '👤': '5303328645329209869',
    '💬': '5443038326535759644', '📋': '5395613344897979554',
    '⚠️': '5447644880824181073',
}


def emoji(symbol):
    return f'<tg-emoji emoji-id="{CUSTOM_EMOJI[symbol]}">{symbol}</tg-emoji>'


STATUS = {'pending': emoji('🟠') + ' Ожидает решения', 'confirmed': emoji('🟢') + ' Подтверждена', 'cancelled': emoji('⚪') + ' Отменена', 'rejected': emoji('🔴') + ' Отклонена'}


def log(event, **fields):
    # Never log Bot API URLs, tokens, passenger names, numbers or comments.
    print(json.dumps({'time': datetime.now(timezone.utc).isoformat(), 'event': event, **fields}, ensure_ascii=False), flush=True)


@dataclass(frozen=True)
class Settings:
    token: str
    admins: tuple[int, ...]
    api_key: str
    api_base: str = 'http://website:3001'
    state_dir: str = '/app/state'
    interval: int = 5

    @classmethod
    def load(cls):
        admins = tuple(dict.fromkeys(int(x.strip()) for x in os.environ.get('TELEGRAM_ADMIN_IDS', '').split(',') if x.strip()))
        cfg = cls(os.environ.get('TELEGRAM_BOT_TOKEN', ''), admins, os.environ.get('TELEGRAM_API_KEY', ''), os.environ.get('SITE_API_URL', 'http://website:3001').rstrip('/'), os.environ.get('BOT_STATE_DIR', '/app/state'), max(3, int(os.environ.get('BOT_POLL_SECONDS', '5'))))
        if not cfg.token or not cfg.admins or any(x <= 0 for x in cfg.admins) or len(cfg.api_key) < 32:
            raise ValueError('Set TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_IDS and TELEGRAM_API_KEY')
        return cfg


class Store:
    def __init__(self, directory):
        Path(directory).mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(Path(directory) / 'delivery.sqlite'))
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA busy_timeout=5000')
        self.db.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value REAL NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS pending (booking_id TEXT PRIMARY KEY)')
        self.db.execute('''CREATE TABLE IF NOT EXISTS messages (
          booking_id TEXT NOT NULL, chat_id INTEGER NOT NULL, message_id INTEGER NOT NULL,
          sent_at REAL NOT NULL, expires_at REAL NOT NULL, fingerprint TEXT NOT NULL,
          removed_at REAL, deletion_failed INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(booking_id,chat_id))''')
        self.db.commit()

    def find(self, booking_id, chat_id):
        return self.db.execute('SELECT * FROM messages WHERE booking_id=? AND chat_id=?', (booking_id, chat_id)).fetchone()

    def setting(self, key, default):
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO meta VALUES(?,?)', (key, default))
        return self.db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()[0]

    def checkpoint(self, now):
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO meta VALUES('last_sync',?)", (now,))

    def enqueue(self, booking_id):
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO pending VALUES(?)', (booking_id,))

    def dequeue(self, booking_id):
        with self.db:
            self.db.execute('DELETE FROM pending WHERE booking_id=?', (booking_id,))

    def forget(self, booking_id, now):
        with self.db:
            self.db.execute('DELETE FROM pending WHERE booking_id=?', (booking_id,))
            self.db.execute('UPDATE messages SET expires_at=? WHERE booking_id=? AND removed_at IS NULL', (now, booking_id))

    def outstanding(self, now):
        return {row[0] for row in self.db.execute('SELECT booking_id FROM pending UNION SELECT booking_id FROM messages WHERE removed_at IS NULL AND expires_at>?', (now,))}

    def sent(self, booking_id, chat_id, message_id, fingerprint, now):
        with self.db:
            self.db.execute('INSERT INTO messages(booking_id,chat_id,message_id,sent_at,expires_at,fingerprint) VALUES(?,?,?,?,?,?)', (booking_id, chat_id, message_id, now, now + DAY, fingerprint))

    def updated(self, booking_id, chat_id, fingerprint):
        with self.db:
            self.db.execute('UPDATE messages SET fingerprint=? WHERE booking_id=? AND chat_id=?', (fingerprint, booking_id, chat_id))

    def due(self, now):
        return self.db.execute('SELECT * FROM messages WHERE removed_at IS NULL AND expires_at<=?', (now,)).fetchall()

    def removed(self, booking_id, chat_id, now, failed=False):
        with self.db:
            self.db.execute('UPDATE messages SET removed_at=?,deletion_failed=? WHERE booking_id=? AND chat_id=?', (now, int(failed), booking_id, chat_id))

    def cleanup(self, now):
        with self.db:
            self.db.execute('DELETE FROM messages WHERE removed_at<? AND booking_id NOT IN (SELECT booking_id FROM pending)', (now - 7 * DAY,))

    def close(self):
        self.db.close()


class SiteError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class Site:
    def __init__(self, settings, session):
        self.settings, self.session = settings, session

    async def request(self, path, payload=None):
        async with self.session.request('POST' if payload is not None else 'GET', self.settings.api_base + '/api/internal/telegram/' + path, headers={'X-Telegram-Key': self.settings.api_key}, json=payload, timeout=aiohttp.ClientTimeout(total=15)) as response:
            data = await response.json()
            if response.status != 200:
                # Only an expected validation message is shown to the admin.
                raise SiteError(data.get('error', 'Сайт временно недоступен'), response.status)
            return data

    async def snapshot(self, since):
        bookings, cursor = [], None
        while True:
            page = await self.request('bookings?since=' + since + ('&cursor=' + cursor if cursor else ''))
            bookings.extend(page['bookings'])
            cursor = page.get('cursor')
            if not cursor:
                return bookings


def normalized_phone(value):
    digits = re.sub(r'\D', '', value)
    if len(digits) == 11 and digits[0] in '78':
        return '+7' + digits[1:]
    return '+7' + digits if len(digits) == 10 else '+' + digits


def message_text(b):
    e = lambda value: html.escape(str(value))
    seats = ', '.join(str(x) for x in b['seats'])
    fare = f"{b['price'] * len(b['seats']):,}".replace(',', ' ')
    date = datetime.fromisoformat(b['date']).strftime('%d.%m.%Y')
    return (f"<b>ПО ПУТИ · ЗАЯВКА #{e(b['id'][:8].upper())}</b>\n"
            f"{STATUS.get(b['status'], 'Статус уточняется')}\n\n"
            f"<b>{e(b['from'])} → {e(b['to'])}</b>\n"
            f"{emoji('📅')} {date} · <b>{e(b['time'])}</b> <i>Красноярск, UTC+7</i>\n"
            f"💺 Места: <b>{e(seats)}</b> · Пассажиров: {len(b['seats'])}\n"
            f"{emoji('💳')} {'от ' if b.get('priceFrom') else ''}<b>{fare} ₽</b> за выбранные места\n\n"
            f"{emoji('👤')} <b>{e(b['name'])}</b>\n"
            f"{emoji('📞')} <code>{e(normalized_phone(b['phone']))}</code>\n"
            + (f"\n{emoji('💬')} {e(b['comment'])}\n" if b.get('comment') else '')
            + "\n<i>Сообщение удалится через 24 часа после отправки. История останется на сайте.</i>")


def keyboard(b, admin_url):
    rows = [[InlineKeyboardButton(text='Номер', icon_custom_emoji_id=CUSTOM_EMOJI['📋'], copy_text=CopyTextButton(text=normalized_phone(b['phone']))), InlineKeyboardButton(text='Имя', icon_custom_emoji_id=CUSTOM_EMOJI['📋'], copy_text=CopyTextButton(text=b['name']))],
            [InlineKeyboardButton(text='Позвонить', icon_custom_emoji_id=CUSTOM_EMOJI['📞'], url=b['call_url'], style='primary'), InlineKeyboardButton(text='↗ Кабинет', url=admin_url)]]
    if b['status'] == 'pending':
        rows.append([InlineKeyboardButton(text='✓ Подтвердить', callback_data='b:confirm:' + b['id'], style='success'), InlineKeyboardButton(text='✕ Отклонить', callback_data='b:reject:' + b['id'], style='danger')])
    elif b['status'] == 'confirmed':
        rows.append([InlineKeyboardButton(text='Отменить заявку', callback_data='b:cancel:' + b['id'], style='danger')])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def fingerprint(b, admin_url=''):
    return hashlib.sha256((message_text(b) + b['call_url'] + admin_url).encode()).hexdigest()


class Service:
    def __init__(self, cfg, bot, site, store, clock=time.time):
        self.cfg, self.bot, self.site, self.store, self.clock = cfg, bot, site, store, clock
        self.admin_url = ''
        self.lock = asyncio.Lock()
        self.started = self.clock()
        self.last_sync = 0
        self.last_poll = 0
        self.last_telegram = self.clock()
        self.backoff = {}
        self.cutoff = self.store.setting('activated_since', self.clock() - DAY)

    async def delete_expired(self):
        now = self.clock()
        for row in self.store.due(now):
            if self.backoff.get(row['chat_id'], 0) > now:
                continue
            try:
                await self.bot.delete_message(row['chat_id'], row['message_id'])
                self.store.removed(row['booking_id'], row['chat_id'], now)
                log('message_expired', booking_id=row['booking_id'], chat_id=row['chat_id'])
            except TelegramForbiddenError:
                self.backoff[row['chat_id']] = now + 60
                log('delete_chat_unavailable', chat_id=row['chat_id'])
            except TelegramRetryAfter as error:
                self.backoff[row['chat_id']] = now + error.retry_after + 1
            except TelegramBadRequest as error:
                reason = str(error).lower()
                # A manually deleted message is already cleaned. Telegram cannot
                # delete an ordinary message after 48h, e.g. after a long outage.
                if 'message to delete not found' in reason or "can't be deleted" in reason or 'cannot be deleted' in reason:
                    missing = 'not found' in reason
                    self.store.removed(row['booking_id'], row['chat_id'], now, failed=not missing)
                    log('message_delete_missing' if missing else 'message_delete_unavailable', booking_id=row['booking_id'], chat_id=row['chat_id'])
                else:
                    raise
        self.store.cleanup(now)

    async def deliver(self, b):
        now, fp = self.clock(), fingerprint(b, self.admin_url)
        created = datetime.fromisoformat(b['created_at'].replace('Z', '+00:00')).timestamp()
        if created < self.cutoff:
            return
        self.store.enqueue(b['id'])
        for admin in self.cfg.admins:
            row = self.store.find(b['id'], admin)
            if row and (row['removed_at'] is not None or row['expires_at'] <= now):
                continue
            if self.backoff.get(admin, 0) > now:
                continue
            try:
                if not row:
                    message = await self.bot.send_message(admin, message_text(b), reply_markup=keyboard(b, self.admin_url))
                    self.store.sent(b['id'], admin, message.message_id, fp, self.clock())
                    log('booking_delivered', booking_id=b['id'], chat_id=admin)
                elif row['fingerprint'] != fp:
                    try:
                        await self.bot.edit_message_text(message_text(b), chat_id=admin, message_id=row['message_id'], reply_markup=keyboard(b, self.admin_url))
                    except TelegramBadRequest as error:
                        if 'message is not modified' not in str(error).lower():
                            if 'message to edit not found' in str(error).lower():
                                self.store.removed(b['id'], admin, now)
                                continue
                            raise
                    self.store.updated(b['id'], admin, fp)
            except TelegramForbiddenError:
                self.backoff[admin] = now + 60
                log('admin_chat_unavailable', chat_id=admin)
            except TelegramRetryAfter as error:
                self.backoff[admin] = now + error.retry_after + 1
                log('telegram_rate_limit', retry_seconds=error.retry_after)
        if all(self.store.find(b['id'], admin) for admin in self.cfg.admins):
            self.store.dequeue(b['id'])

    async def sync_once(self):
        async with self.lock:
            await self.delete_expired()
            config = await self.site.request('config')
            self.admin_url = config['admin_url']
            last_sync = self.store.setting('last_sync', self.cutoff)
            since = datetime.fromtimestamp(max(self.cutoff, min(self.clock() - 48 * 3600, last_sync - 60)), timezone.utc).isoformat().replace('+00:00', 'Z')
            bookings = await self.site.snapshot(since)
            seen = {b['id'] for b in bookings}
            for booking_id in self.store.outstanding(self.clock()) - seen:
                try:
                    bookings.append(await self.site.request('bookings/' + booking_id))
                except SiteError as error:
                    if error.status != 404:
                        raise
                    self.store.forget(booking_id, self.clock())
            for b in bookings:
                await self.deliver(b)
            self.last_sync = self.clock()
            self.store.checkpoint(self.last_sync)

    async def action(self, callback):
        if not callback.from_user or callback.from_user.id not in self.cfg.admins or not callback.message or callback.message.chat.type != 'private' or callback.message.chat.id != callback.from_user.id:
            await callback.answer('Нет доступа', show_alert=True)
            return
        match = re.fullmatch(r'b:(confirm|reject|cancel):([a-f0-9-]{36})', callback.data or '')
        if not match:
            await callback.answer('Неизвестное действие', show_alert=True)
            return
        action, booking_id = match.groups()
        async with self.lock:
            row = self.store.find(booking_id, callback.from_user.id)
            if not row or row['removed_at'] is not None or row['expires_at'] <= self.clock() or row['message_id'] != callback.message.message_id:
                await callback.answer('Сообщение устарело. Откройте кабинет сайта.', show_alert=True)
                return
            # Acknowledge first so Telegram does not time out on slow requests.
            await callback.answer('Обрабатываю…')
            try:
                b = await self.site.request('bookings/' + booking_id, {'action': action, 'admin_id': callback.from_user.id})
                await self.deliver(b)
                log('booking_action', booking_id=booking_id, admin_id=callback.from_user.id, action=action)
            except SiteError as error:
                # Seat-conflict errors are shown in the existing card, not a
                # stream of passenger messages or untracked temporary replies.
                current = await self.site.request('bookings/' + booking_id)
                await self.bot.edit_message_text(message_text(current) + '\n\n' + emoji('⚠️') + ' ' + html.escape(str(error)), chat_id=callback.from_user.id, message_id=row['message_id'], reply_markup=keyboard(current, self.admin_url))

    async def background(self):
        while True:
            try:
                await self.sync_once()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                log('sync_retry', error_type=type(error).__name__)
            await asyncio.sleep(self.cfg.interval)

    async def watchdog(self):
        while True:
            now = self.clock()
            # getUpdates succeeds every polling timeout, even with no updates.
            if now - self.started > 180 and (now - self.last_poll > 180 or now - self.last_sync > 180):
                log('watchdog_restart', sync_age=int(now - self.last_sync), polling_age=int(now - self.last_poll))
                raise RuntimeError('Service watchdog timeout')
            if now - self.last_telegram > 60:
                try:
                    await self.bot.get_me()
                    self.last_telegram = self.clock()
                except Exception as error:
                    log('telegram_probe_retry', error_type=type(error).__name__)
            target = Path(self.cfg.state_dir) / 'heartbeat.json'
            temporary = target.with_suffix('.tmp')
            temporary.write_text(json.dumps({'time': now, 'sync': self.last_sync, 'poll': self.last_poll}), encoding='utf-8')
            temporary.replace(target)
            await asyncio.sleep(15)


class AdminOnly(BaseMiddleware):
    def __init__(self, admins):
        self.admins = admins

    async def __call__(self, handler, event, data):
        user = getattr(event, 'from_user', None)
        message = getattr(event, 'message', None)
        chat = getattr(event, 'chat', None) or getattr(message, 'chat', None)
        if not user or user.id not in self.admins or not chat or chat.type != 'private' or chat.id != user.id:
            return None
        return await handler(event, data)


async def run(cfg):
    # Suppress dependency tracebacks that can include request contents/tokens.
    logging.basicConfig(level=logging.CRITICAL)
    os.umask(0o077)
    store = Store(cfg.state_dir)
    async with aiohttp.ClientSession() as session:
        bot = Bot(cfg.token, default=DefaultBotProperties(parse_mode='HTML', link_preview=LinkPreviewOptions(is_disabled=True)))
        service = Service(cfg, bot, Site(cfg, session), store)
        # Poll heartbeat measures successful getUpdates, not incoming messages.
        from aiogram.methods import GetUpdates
        class PollHeartbeat(BaseRequestMiddleware):
            async def __call__(self, make_request, telegram_bot, method):
                result = await make_request(telegram_bot, method)
                if isinstance(method, GetUpdates):
                    service.last_poll = service.clock()
                return result
        bot.session.middleware(PollHeartbeat())
        dp = Dispatcher()
        dp.message.outer_middleware(AdminOnly(cfg.admins))
        dp.callback_query.outer_middleware(AdminOnly(cfg.admins))

        @dp.message(CommandStart())
        @dp.message(Command('status'))
        async def dashboard(message):
            last_sync = datetime.fromtimestamp(service.last_sync, KRASNOYARSK).strftime('%d.%m %H:%M:%S') if service.last_sync else 'ожидается первое соединение'
            text = ("<b>ПО ПУТИ · ДИСПЕТЧЕРСКАЯ</b>\n\n"
                    "Заявки с сайта поступают сюда автоматически.\n"
                    "Решения синхронизируются с сайтом и вторым администратором.\n\n"
                    f"Последняя синхронизация: {last_sync} · Красноярск\n"
                    "Карточки хранятся в чате 24 часа.")
            await message.answer(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text='↗ Открыть кабинет', url=service.admin_url or (await service.site.request('config'))['admin_url'])]]))

        @dp.callback_query()
        async def callback_handler(callback):
            await service.action(callback)

        @dp.errors()
        async def handler_error(event):
            log('handler_error', error_type=type(event.exception).__name__)
            return True

        tasks = []
        try:
            await bot.delete_webhook(drop_pending_updates=False)
            tasks = [asyncio.create_task(service.background()), asyncio.create_task(service.watchdog()), asyncio.create_task(dp.start_polling(bot, polling_timeout=25, handle_signals=False, close_bot_session=False, allowed_updates=['message', 'callback_query']))]
            log('bot_started', admin_count=len(cfg.admins))
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
            raise RuntimeError('Unexpected task completion')
        finally:
            for task in tasks:
                task.cancel()
            for task in tasks:
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
            await bot.session.close()
            store.close()


if __name__ == '__main__':
    try:
        asyncio.run(run(Settings.load()))
    except KeyboardInterrupt:
        pass
    except Exception as error:
        log('bot_stopped', error_type=type(error).__name__)
        raise SystemExit(1) from None
