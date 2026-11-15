# bb-plugin-mac-watch

Мониторинг Мака, на котором работает BB-сервер. Страница в сайдбаре, CLI `bb mac-watch` и навык для агентов.

Описание для пользователей: [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) (English, для маркетплейса) и [PLUGIN_OVERVIEW.ru.md](PLUGIN_OVERVIEW.ru.md) (по-русски).

## Разработка

```sh
npm install
npm test            # разбор вывода утилит на реальных фикстурах (test/fixtures)
npm run typecheck
bb plugin build
bb plugin install "$PWD" --yes   # или bb plugin reload mac-watch
```

- `core.ts`: чистые парсеры, предупреждения, вердикт «уснёт ли Мак», форматирование.
- `collector.ts`: запускает утилиты macOS и собирает `Snapshot`.
- `helpers/temps.c`: читает температурные датчики Apple Silicon через IOHID без root. Плагин сам компилирует её при старте (`xcrun clang`) в `.build/`. Если компилятора нет, температур просто не будет.
- `icons.ts`: иконки приложений из `.app` через `sips`, с кэшем.
- `power.ts`: погасить экран, сон (с таймером пробуждения) и выключение. Флаг `disablesleep` возвращается после настоящего пробуждения.
- `sudoers/install.sh`: правило NOPASSWD только для `pmset disablesleep 0|1`, `pmset relative wake 3600|14400|28800` и `shutdown -h now`. Пользователь запускает его сам: `sh sudoers/install.sh`.
- `server.ts`: фоновый опрос каждые 15 с, история за 24 ч, RPC и CLI.
- `app.tsx` и `style.css`: страница.

В фикстурах `test/fixtures` серийные номера батареи и адаптера заменены на `REDACTED`.
