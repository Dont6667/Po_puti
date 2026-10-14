import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from datetime import datetime, timezone
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock

from aiogram.exceptions import TelegramBadRequest
from aiogram.methods import DeleteMessage, SendMessage
from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.client.telegram import TelegramAPIServer
from aiohttp import web
from app import CUSTOM_EMOJI, emoji, AdminOnly, DAY, Service, Settings, Store, fingerprint, keyboard, message_text


class BotTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.now = 1_800_000_000.0
        self.cfg = Settings('123456:FAKE_TEST_TOKEN', (6056397902, 5673533667), 'a' * 64, state_dir=self.directory.name)
        self.store = Store(self.directory.name)
        self.bot = SimpleNamespace(send_message=AsyncMock(side_effect=[SimpleNamespace(message_id=11), SimpleNamespace(message_id=22)]), edit_message_text=AsyncMock(), delete_message=AsyncMock())
        self.site = SimpleNamespace(request=AsyncMock(return_value={'admin_url': 'https://example.test/private-admin'}), snapshot=AsyncMock())
        self.service = Service(self.cfg, self.bot, self.site, self.store, lambda: self.now)
        self.service.admin_url = 'https://example.test/private-admin'
        self.booking = dict(id='12345678-1234-1234-1234-123456789abc', status='pending', created_at=datetime.fromtimestamp(self.now, timezone.utc).isoformat(), updated_at='x', date='2027-02-01', time='08:00', seats=[1, 2], price=2200, priceFrom=False, name='<Иван>', phone='8 (999) 123-45-67', comment='<script>test</script>', call_url='https://example.test/tg-call/signed', **{'from': 'Красноярск', 'to': 'Шира'})

    def tearDown(self):
        self.store.close()
        self.directory.cleanup()

    async def test_delivery_to_both_no_duplicate_and_status_sync(self):
        await self.service.deliver(self.booking)
        await self.service.deliver(self.booking)
        self.assertEqual(self.bot.send_message.await_count, 2)
        for call in self.bot.send_message.await_args_list:
            self.assertIs(call.kwargs['disable_notification'], False)
        original_expiry = self.store.find(self.booking['id'], self.cfg.admins[0])['expires_at']
        # Persisted state survives service reconstruction/restart.
        service2 = Service(self.cfg, self.bot, self.site, self.store, lambda: self.now)
        service2.admin_url = self.service.admin_url
        changed = {**self.booking, 'status': 'confirmed'}
        self.now += 600
        await service2.deliver(changed)
        self.assertEqual(self.bot.edit_message_text.await_count, 2)
        self.assertEqual(self.bot.send_message.await_count, 2)
        self.assertEqual(self.store.find(self.booking['id'], self.cfg.admins[0])['expires_at'], original_expiry)

    async def test_expiry_is_24_hours_after_send_not_edit(self):
        await self.service.deliver(self.booking)
        self.now += DAY - 1
        await self.service.delete_expired()
        self.bot.delete_message.assert_not_awaited()
        self.now += 2
        await self.service.delete_expired()
        self.assertEqual(self.bot.delete_message.await_count, 2)
        await self.service.deliver(self.booking)
        self.assertEqual(self.bot.send_message.await_count, 2)

    async def test_manually_deleted_message_does_not_block_cleanup(self):
        await self.service.deliver(self.booking)
        self.now += DAY + 1
        self.bot.delete_message.side_effect = TelegramBadRequest(method=DeleteMessage(chat_id=1, message_id=1), message='message to delete not found')
        await self.service.delete_expired()
        self.assertIsNotNone(self.store.find(self.booking['id'], self.cfg.admins[0])['removed_at'])

    async def test_old_backlog_not_sent_and_data_escaped(self):
        old = {**self.booking, 'created_at': datetime.fromtimestamp(self.now - DAY - 1, timezone.utc).isoformat()}
        await self.service.deliver(old)
        self.bot.send_message.assert_not_awaited()
        self.assertIn('&lt;Иван&gt;', message_text(self.booking))
        self.assertNotIn('<script>', message_text(self.booking))
        markup = keyboard(self.booking, 'https://example.test/admin').model_dump(exclude_none=True)
        self.assertEqual(markup['inline_keyboard'][0][0]['copy_text']['text'], '+79991234567')
        self.assertEqual(markup['inline_keyboard'][2][0]['style'], 'success')
        self.assertEqual(markup['inline_keyboard'][2][1]['style'], 'danger')

    async def test_custom_emoji_text_and_buttons(self):
        text = message_text(self.booking)
        for symbol in ['🚐', '🟠', '📅', '💳', '👤', '📞', '💬']:
            self.assertIn(emoji(symbol), text)
        self.assertIn('💺 Места:', text)
        self.assertNotIn('💺', CUSTOM_EMOJI)
        buttons = keyboard(self.booking, 'https://example.test/admin').inline_keyboard
        self.assertEqual(buttons[0][0].icon_custom_emoji_id, CUSTOM_EMOJI['📋'])
        self.assertEqual(buttons[0][1].icon_custom_emoji_id, CUSTOM_EMOJI['📋'])
        self.assertEqual(buttons[1][0].icon_custom_emoji_id, CUSTOM_EMOJI['📞'])
        self.assertEqual(buttons[1][0].text, 'Позвонить')
        self.assertEqual(buttons[2][0].icon_custom_emoji_id, CUSTOM_EMOJI['🟢'])
        self.assertEqual(buttons[2][1].icon_custom_emoji_id, CUSTOM_EMOJI['🔴'])
        for status, symbol in [('confirmed', '🟢'), ('cancelled', '⚪'), ('rejected', '🔴')]:
            self.assertIn(emoji(symbol), message_text({**self.booking, 'status': status}))

    async def test_menu_reuses_persisted_message_and_input_deleted(self):
        self.store.remember_admin(self.cfg.admins[0], '<Кирилл>')
        await self.service.panel(self.cfg.admins[0])
        self.assertIn('&lt;Кирилл&gt;, добро пожаловать!', self.bot.send_message.call_args.args[1])
        self.assertEqual(self.store.panel(self.cfg.admins[0]), 11)
        await self.service.panel(self.cfg.admins[0])
        self.assertEqual(self.bot.send_message.await_count, 1)
        self.assertEqual(self.bot.edit_message_text.await_count, 1)
        await self.service.remove_input(SimpleNamespace(chat=SimpleNamespace(id=self.cfg.admins[0]), message_id=99))
        self.bot.delete_message.assert_awaited_with(self.cfg.admins[0], 99)

    async def test_history_pagination_and_card_in_same_panel(self):
        self.site.snapshot.return_value = [{**self.booking, 'id': f'{i:08x}-1234-1234-1234-123456789abc'} for i in range(8)]
        await self.service.panel(self.cfg.admins[0], 'list:0')
        self.site.snapshot.assert_awaited_with('1970-01-01T00:00:00Z')
        markup = self.bot.send_message.call_args.kwargs['reply_markup']
        self.assertEqual(len(markup.inline_keyboard), 8)
        self.site.request.side_effect = [{'admin_url': self.service.admin_url}, self.booking]
        await self.service.panel(self.cfg.admins[0], 'book:' + self.booking['id'])
        self.assertEqual(self.bot.send_message.await_count, 1)
        markup = self.bot.edit_message_text.call_args.kwargs['reply_markup']
        self.assertTrue(markup.inline_keyboard[2][0].callback_data.startswith('ui:act:confirm:'))
        self.assertNotIn('Сообщение удалится', self.bot.edit_message_text.call_args.args[0])

    async def test_unstarted_admin_does_not_block_other_admin_or_future_bookings(self):
        self.bot.send_message.side_effect = [
            TelegramBadRequest(method=SendMessage(chat_id=1, text='test'), message='Bad Request: chat not found'),
            SimpleNamespace(message_id=22), SimpleNamespace(message_id=23)]
        await self.service.deliver(self.booking)
        self.assertIsNone(self.store.find(self.booking['id'], self.cfg.admins[0]))
        self.assertIsNotNone(self.store.find(self.booking['id'], self.cfg.admins[1]))
        newer = {**self.booking, 'id': '22345678-1234-1234-1234-123456789abc'}
        await self.service.deliver(newer)
        self.assertIsNotNone(self.store.find(newer['id'], self.cfg.admins[1]))
        self.assertIn(self.booking['id'], self.store.outstanding(self.now))

    async def test_access_only_private_allowlist(self):
        gate = AdminOnly(self.cfg.admins)
        handler = AsyncMock()
        for user, chat_id, kind in [(42, 42, 'private'), (6056397902, -1, 'group')]:
            await gate(handler, SimpleNamespace(from_user=SimpleNamespace(id=user), chat=SimpleNamespace(id=chat_id, type=kind)), {})
        handler.assert_not_awaited()
        event = SimpleNamespace(from_user=SimpleNamespace(id=6056397902), chat=SimpleNamespace(id=6056397902, type='private'))
        await gate(handler, event, {})
        handler.assert_awaited_once()

    async def test_callback_syncs_both_and_stale_callback_rejected(self):
        await self.service.deliver(self.booking)
        callback = SimpleNamespace(from_user=SimpleNamespace(id=self.cfg.admins[0]), message=SimpleNamespace(message_id=11, chat=SimpleNamespace(type='private', id=self.cfg.admins[0])), data='b:confirm:' + self.booking['id'], answer=AsyncMock())
        self.site.request.return_value = {**self.booking, 'status': 'confirmed'}
        await self.service.action(callback)
        self.site.request.assert_awaited_once_with('bookings/' + self.booking['id'], {'action': 'confirm', 'admin_id': self.cfg.admins[0]})
        self.assertEqual(self.bot.edit_message_text.await_count, 2)
        self.site.request.reset_mock()
        self.now += DAY + 1
        await self.service.action(callback)
        self.site.request.assert_not_awaited()

    async def test_delivery_network_failure_does_not_lose_unsent_booking(self):
        self.bot.send_message.side_effect = ConnectionError()
        with self.assertRaises(ConnectionError):
            await self.service.deliver(self.booking)
        self.assertIsNone(self.store.find(self.booking['id'], self.cfg.admins[0]))
        self.bot.send_message.side_effect = [SimpleNamespace(message_id=11), SimpleNamespace(message_id=22)]
        await self.service.deliver(self.booking)
        self.assertIsNotNone(self.store.find(self.booking['id'], self.cfg.admins[0]))

    async def test_outage_backlog_is_delivered_even_after_a_day(self):
        self.now += 3 * DAY
        # Bookings created after activation must not disappear just because
        # Telegram/site was offline for longer than the message retention TTL.
        await self.service.deliver(self.booking)
        self.assertEqual(self.bot.send_message.await_count, 2)
        self.assertEqual(self.store.find(self.booking['id'], self.cfg.admins[0])['expires_at'], self.now + DAY)

    async def test_watchdog_stops_failed_service(self):
        self.service.started = self.now - 181
        self.service.last_sync = self.now - 181
        self.service.last_poll = self.now
        with self.assertRaises(RuntimeError):
            await self.service.watchdog()

    async def test_health_requires_fresh_sync_and_valid_database(self):
        path = Path(self.directory.name) / 'heartbeat.json'
        now = time.time()
        probe = Path(__file__).parent / 'healthcheck.py'
        env = {**os.environ, 'BOT_STATE_DIR': self.directory.name}
        path.write_text(json.dumps(dict(time=now, sync=now, poll=now)))
        self.assertEqual(subprocess.run([sys.executable, str(probe)], env=env).returncode, 0)
        path.write_text(json.dumps(dict(time=now, sync=now - 200, poll=now)))
        self.assertEqual(subprocess.run([sys.executable, str(probe)], env=env).returncode, 1)

    async def test_real_aiogram_serialization_against_local_api_stub(self):
        calls = []
        async def endpoint(request):
            data = dict(await request.post())
            method = request.match_info['method']
            calls.append((method, data))
            if method == 'deleteMessage':
                return web.json_response({'ok': True, 'result': True})
            return web.json_response({'ok': True, 'result': {'message_id': len(calls), 'date': int(time.time()), 'chat': {'id': int(data['chat_id']), 'type': 'private'}, 'text': data['text']}})
        application = web.Application()
        application.router.add_post('/bot{token}/{method}', endpoint)
        runner = web.AppRunner(application)
        await runner.setup()
        server = web.TCPSite(runner, '127.0.0.1', 0)
        await server.start()
        port = server._server.sockets[0].getsockname()[1]
        session = AiohttpSession(api=TelegramAPIServer.from_base(f'http://127.0.0.1:{port}'))
        bot = Bot('123456:TEST_TOKEN_FOR_LOCAL_STUB_ONLY', session=session, default=DefaultBotProperties(parse_mode='HTML'))
        service = Service(self.cfg, bot, self.site, self.store, lambda: self.now)
        service.admin_url = self.service.admin_url
        try:
            await service.deliver(self.booking)
            self.assertEqual(len(calls), 2)
            markup = json.loads(calls[0][1]['reply_markup'])
            self.assertEqual(markup['inline_keyboard'][0][0]['copy_text']['text'], '+79991234567')
            self.assertEqual(markup['inline_keyboard'][2][0]['style'], 'success')
            self.now += DAY + 1
            await service.delete_expired()
            self.assertEqual([x[0] for x in calls[-2:]], ['deleteMessage', 'deleteMessage'])
        finally:
            await bot.session.close()
            await runner.cleanup()


if __name__ == '__main__':
    unittest.main()
