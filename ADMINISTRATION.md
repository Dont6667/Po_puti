# По пути — памятка администратора

Сайт: https://poputi-vmeste.ru  
IP VPS: 150.241.97.74  
Проект на VPS: `~/Po_puti`  
База: SQLite, файл `/app/data/content.sqlite` внутри контейнера.  
Основной режим: `compose.production.yaml` — сайт и Caddy с HTTPS.

Команды ниже выполняются в SSH на VPS, если отдельно не указано «на компьютере». Пароли, резервные копии и вывод заявок не отправляйте в публичные чаты. Закрытие SSH не останавливает контейнеры.

## 1. Подключиться и перейти к проекту

На компьютере в PowerShell или терминале:

```bash
ssh root@150.241.97.74
```

Подключает к VPS. Используйте свой SSH-ключ или пароль VPS.

На VPS:

```bash
cd ~/Po_puti
```

Все дальнейшие команды Docker Compose выполняйте из этой папки.

## 2. Применить изменения с GitHub

```bash
cd ~/Po_puti
sudo bash deploy/update.sh
```

Создаёт резервную копию текущей базы и загруженных фото, получает изменения из GitHub, собирает и запускает контейнер. При копировании сайт ненадолго останавливается. Данные в постоянных volumes сохраняются. Если Git обнаружит локальные изменения, обновление остановится — сначала разберитесь с ними.

```bash
git status --short
git log -5 --oneline
```

Первая команда показывает локальные изменения, вторая — последние пять коммитов. Не используйте `git reset --hard`, чтобы просто убрать сообщение об изменениях: сначала проверьте, что изменено.

```bash
sudo docker compose -f compose.production.yaml up -d --build --wait --wait-timeout 300
```

Пересобирает и запускает уже имеющийся код без загрузки из GitHub. В отличие от `update.sh`, резервную копию сама не создаёт.

## 3. Проверить сайт и HTTPS

```bash
curl --fail --show-error https://poputi-vmeste.ru/api/health
```

Ожидаемый ответ: `{"ok":true}`. Проверяет ответ сайта и доверенный HTTPS-сертификат. Не добавляйте `-k`: он скрывает ошибки сертификата.

```bash
curl -I https://poputi-vmeste.ru/
curl -I http://poputi-vmeste.ru/
```

Первая команда показывает HTTP-статус главной страницы. Вторая должна показать перенаправление на HTTPS.

```bash
sudo docker compose -f compose.production.yaml ps
```

Показывает контейнеры. `website` должен быть `Up ... (healthy)`, `proxy` — `Up`. Проверка `healthy` обнаруживает проблему, но сама не перезапускает зависший процесс.

```bash
getent ahostsv4 poputi-vmeste.ru
```

Проверяет DNS на VPS: должен появиться `150.241.97.74`.

После значимого обновления также проверьте вручную: главную на телефоне, поиск рейса, выбор мест, тестовую заявку, её подтверждение в админке и загрузку фото. Тестовую заявку затем отмените в админке.

## 4. Смотреть логи

```bash
sudo docker compose -f compose.production.yaml logs --tail=100 website
```

Последние сообщения сайта и ошибки приложения.

```bash
sudo docker compose -f compose.production.yaml logs --tail=100 proxy
```

Журнал Caddy: запуск HTTPS и получение сертификатов.

```bash
sudo docker compose -f compose.production.yaml logs --since=30m --timestamps
```

Сообщения всех сервисов за последние 30 минут с временными метками.

```bash
sudo docker compose -f compose.production.yaml logs -f --tail=50
```

Следит за новыми сообщениями. `Ctrl+C` прекращает просмотр, сайт продолжает работать. Сейчас это журналы процессов, не отдельная система аналитики всех посещений.

## 5. Перезапустить, остановить и запустить

```bash
sudo docker compose -f compose.production.yaml restart website
```

Перезапускает приложение, не пересобирая код. Открытые сессии админки сбросятся — потребуется вход заново.

```bash
sudo docker compose -f compose.production.yaml restart proxy
```

Перезапускает Caddy. Не удаляет сертификаты. При ошибке NXDOMAIN сначала исправьте DNS, постоянные перезапуски не помогут.

```bash
sudo docker compose -f compose.production.yaml stop
sudo docker compose -f compose.production.yaml up -d --wait --wait-timeout 300
```

Первая команда намеренно останавливает сайт и HTTPS. Вторая запускает их снова. `restart: unless-stopped` восстанавливает работу после падения и перезагрузки VPS, но не отменяет вашу ручную остановку.

```bash
sudo systemctl is-enabled docker
sudo systemctl status docker --no-pager
```

Проверяет автозапуск Docker и состояние службы.

## 6. Адрес и пароль админки

```bash
sudo docker compose -f compose.production.yaml exec -T website cat /app/data/admin-route.txt
```

Выводит только путь кабинета `/manage-...`. Добавьте его к `https://poputi-vmeste.ru`.

```bash
sudo docker compose -f compose.production.yaml exec -T website cat /app/data/admin-access.txt
```

Выводит сохранённый адрес и первоначальные данные доступа. На VPS адрес автоматически использует домен из `.env`, а при локальном запуске — адрес и порт локального сервера. Если пароль уже меняли в кабинете, ориентируйтесь на новый пароль: этот файл не обязательно отражает его.

Имена, стаж, фото, маршруты, цены и контакты меняйте через админку и сохраняйте. Прямое изменение SQL может нарушить проверку мест и связей заявок.

## 7. Просмотр базы без изменения данных

SQLite уже доступна через Node внутри контейнера. Устанавливать отдельный SQLite-сервер не требуется. Эти команды открывают базу с `readOnly:true` и не импортируют модули приложения.

### Список таблиц

```bash
sudo docker compose -f compose.production.yaml exec -T website node --input-type=module -e 'import {DatabaseSync} from "node:sqlite";const db=new DatabaseSync("/app/data/content.sqlite",{readOnly:true});console.table(db.prepare("SELECT name FROM sqlite_master WHERE type=? ORDER BY name").all("table"));db.close();'
```

Показывает `settings`, `bookings`, `confirmed_seats` и `booking_audit`.

### Количество заявок по статусам

```bash
sudo docker compose -f compose.production.yaml exec -T website node --input-type=module -e 'import {DatabaseSync} from "node:sqlite";const db=new DatabaseSync("/app/data/content.sqlite",{readOnly:true});console.table(db.prepare("SELECT status,COUNT(*) AS total FROM bookings GROUP BY status").all());db.close();'
```

Статусы: `pending` — ожидает, `confirmed` — подтверждена, `cancelled` — отменена, `rejected` — отклонена.

### Последние 20 заявок без телефонов и имён

```bash
sudo docker compose -f compose.production.yaml exec -T website node --input-type=module -e 'import {DatabaseSync} from "node:sqlite";const db=new DatabaseSync("/app/data/content.sqlite",{readOnly:true});console.table(db.prepare("SELECT id,status,created_at,json_extract(data,\u0027$.from\u0027) AS departure,json_extract(data,\u0027$.to\u0027) AS destination,json_extract(data,\u0027$.date\u0027) AS trip_date FROM bookings ORDER BY created_at DESC LIMIT 20").all());db.close();'
```

Для просмотра имени, телефона и комментария удобнее открыть заявку в админке.

### Подтверждённые места

```bash
sudo docker compose -f compose.production.yaml exec -T website node --input-type=module -e 'import {DatabaseSync} from "node:sqlite";const db=new DatabaseSync("/app/data/content.sqlite",{readOnly:true});console.table(db.prepare("SELECT route,date,time,seat,booking_id FROM confirmed_seats ORDER BY date DESC,time,seat LIMIT 50").all());db.close();'
```

Показывает закреплённые места. Не удаляйте строки вручную — отменяйте заявки через админку.

### Последние действия с заявками

```bash
sudo docker compose -f compose.production.yaml exec -T website node --input-type=module -e 'import {DatabaseSync} from "node:sqlite";const db=new DatabaseSync("/app/data/content.sqlite",{readOnly:true});console.table(db.prepare("SELECT booking_id,action,created_at FROM booking_audit ORDER BY id DESC LIMIT 30").all());db.close();'
```

### Проверка целостности SQLite

```bash
sudo docker compose -f compose.production.yaml exec -T website node --input-type=module -e 'import {DatabaseSync} from "node:sqlite";const db=new DatabaseSync("/app/data/content.sqlite",{readOnly:true});console.table(db.prepare("PRAGMA quick_check").all());db.close();'
```

Ожидаемый результат: `ok`. Это проверка структуры базы, а не всех бизнес-правил.

## 8. Резервная копия

```bash
cd ~/Po_puti
sudo bash deploy/backup.sh
```

Создаёт папку `backups/<дата-в-UTC>/` с базой, загруженными фото, `.env` и номером коммита. При копировании приложение остановлено для согласованности SQLite; затем автоматически запускается.

```bash
sudo ls -lt backups
```

Показывает копии. Их нужно сохранять также вне VPS.

На компьютере, заменив `ИМЯ_КОПИИ` реальным именем папки:

```bash
scp -r root@150.241.97.74:~/Po_puti/backups/ИМЯ_КОПИИ .
```

Скачивает резервную копию в текущую папку. Она содержит персональные данные и данные доступа.

Не копируйте только `content.sqlite` у работающего сайта: свежие изменения могут находиться в WAL. Для восстановления данных остановите приём новых заявок и согласуйте, какие данные копии заменят текущие. Старое восстановление может потерять новые заявки — универсальной безопасной команды для этого здесь нет.

## 9. Если VPS тормозит

```bash
df -h
free -h
sudo docker stats --no-stream
```

Показывает свободное место, память и потребление контейнеров. Удаление фона фотографии может временно увеличивать нагрузку.

## 10. Временный показ по IP без домена

```bash
cd ~/Po_puti
sudo docker compose -f compose.production.yaml stop
bash deploy/preview.sh
```

Открывает `http://150.241.97.74/`. Это HTTP без шифрования: используйте только тестовые заявки.

Вернуться к HTTPS:

```bash
cd ~/Po_puti
sudo docker compose -f compose.yaml stop
sudo bash deploy/start.sh
```

Предполагается, что `.env` уже содержит `DOMAIN=poputi-vmeste.ru` и DNS ведёт на VPS.

## 11. Отправить изменения с компьютера в GitHub

В PowerShell на компьютере:

```powershell
cd G:\Projects\po-puti-second-site
& "C:\Program Files\Git\cmd\git.exe" status
& "C:\Program Files\Git\cmd\git.exe" add public content-store.mjs initial-content.json
& "C:\Program Files\Git\cmd\git.exe" commit -m "Update website"
& "C:\Program Files\Git\cmd\git.exe" push origin main
```

Пример отправки изменённых файлов сайта. Проверьте `status` и выбирайте только нужные файлы. Пароли, `.env`, базу, заявки и резервные копии в Git не добавляйте. После push примените пункт 2 на VPS.

## Не выполнять для обычного обновления

- `docker compose down -v` — удаляет volumes с базой и фото.
- `docker volume prune` — может удалить неиспользуемые хранилища.
- Ручные `DELETE` / `UPDATE` в рабочей базе — обходят проверки приложения.
- Повторный экспорт локальных начальных данных не заменяет настройки существующей базы VPS.

Памятка подготовлена 14 октября 2026 года для текущей структуры проекта. Время поездок — Красноярск; резервные копии именуются по UTC.
# Сборка после изменения оформления и скриптов

Telegram-диспетчер, запуск, логи и удаление карточек через сутки описаны в [TELEGRAM-BOT.md](TELEGRAM-BOT.md). Для первого подключения на VPS: `sudo bash deploy/setup-telegram.sh`. При дальнейших обновлениях бот перезапускается вместе с сайтом.

На VPS `sudo bash deploy/update.sh` собирает оптимизированные файлы автоматически в Docker. Для локальной разработки после правок CSS/JS выполните `npm run build` и перезапустите сервер. Подготовка шрифтов через Python нужна только при замене самих исходных шрифтов; готовые файлы уже включены в репозиторий.


Защита от перегрузки и проверка защиты у XorekCloud: [SECURITY-OPERATIONS.md](SECURITY-OPERATIONS.md).
